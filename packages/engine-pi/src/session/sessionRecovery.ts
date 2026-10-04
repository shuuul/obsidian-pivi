/**
 * Classify and recover session JSONL / journal divergence without overwriting
 * an externally changed source or discarding a locally completed turn.
 */

import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import {
  acknowledgeJournalEntry,
  listActiveJournalEntries,
  recordRecoveredIdentity,
  removeJournalEntry,
  sealJournalEntryWithAppend,
  type SessionJournalEntryV1,
  type SessionJournalStore,
  upsertJournalEntry,
} from '@pivi/agent/session/sessionJournal';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '@pivi/agent/session/sessionPaths';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import {
  classifyJournalDivergence,
  fingerprintsContentEqual,
  lastEntryIdInLines,
  lastEntryIdInPrefix,
  materializeIntentLines,
  observedAppendLines,
  prefixMatchesBase,
  reparentFirstEntry,
  resolveAppendLines,
  type SessionDivergenceClassification,
} from './sessionDivergence';
import {
  captureSessionJsonlSource,
  invalidateSessionJsonlIndex,
} from './sessionJsonlIndex';

export {
  classifyJournalDivergence,
} from './sessionDivergence';

const logger = new PluginLogger('SessionRecovery');

/** Write a session file atomically via temp + rename, cleaning up the temp on failure. */
function writeAtomicFileSync(absoluteFile: string, body: Buffer): void {
  const temporary = `${absoluteFile}.tmp-${process.pid}`;
  writeFileSync(temporary, body);
  try {
    renameSync(temporary, absoluteFile);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup; the rename error is the real failure.
    }
    throw error;
  }
}

export interface SessionRecoveryResult {
  classification: SessionDivergenceClassification;
  action:
    | 'ack'
    | 'apply_append'
    | 'complete_interrupted'
    | 'recovered_session'
    | 'noop';
  recoveredSessionFile?: string;
  noticeKey?: 'host.sessionRecovery.recovered' | 'host.sessionRecovery.applied';
  noticeParams?: Record<string, string>;
}

function buildRecoveredFromLinesOnly(
  source: Buffer | null,
  lines: readonly string[],
  entry: SessionJournalEntryV1,
  recoveredTitle: string,
): Buffer {
  let headerLine: string | null = null;
  if (source && source.length > 0) {
    const newline = source.indexOf(0x0a);
    const rawHeader = source.subarray(0, newline >= 0 ? newline : source.length).toString('utf8');
    try {
      const parsed = JSON.parse(rawHeader) as Record<string, unknown>;
      if (parsed.type === 'session' && typeof parsed.id === 'string') {
        headerLine = JSON.stringify({
          ...parsed,
          id: `recovered-${entry.id.slice(0, 12)}`,
        });
      }
    } catch {
      headerLine = null;
    }
  }
  if (!headerLine) {
    headerLine = JSON.stringify({
      type: 'session',
      version: 3,
      id: `recovered-${entry.id.slice(0, 12)}`,
      timestamp: new Date(entry.createdAt).toISOString(),
      cwd: '',
      parentSession: null,
    });
  }
  const recoveredLines = reparentFirstEntry(lines, null);
  const provenance = JSON.stringify({
    type: 'custom',
    id: `prov-${entry.id.slice(0, 12)}`,
    parentId: lastEntryIdInLines(recoveredLines),
    timestamp: new Date().toISOString(),
    customType: 'pivi/session-meta',
    data: {
      title: recoveredTitle,
      titleSource: 'custom',
      createdAt: entry.createdAt,
      recoverySourceSessionFile: entry.sessionFile,
      recoveryJournalEntryId: entry.id,
    },
  });
  return Buffer.from([headerLine, ...recoveredLines, provenance].join('\n') + '\n', 'utf8');
}

function rewriteRecoveredSessionHeader(
  prefix: Buffer,
  entry: SessionJournalEntryV1,
): Buffer | null {
  const newline = prefix.indexOf(0x0a);
  if (newline < 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(prefix.subarray(0, newline).toString('utf8')) as Record<string, unknown>;
    if (parsed.type !== 'session' || typeof parsed.id !== 'string') {
      return null;
    }
    const header = Buffer.from(`${JSON.stringify({
      ...parsed,
      id: `recovered-${entry.id.slice(0, 12)}`,
    })}\n`, 'utf8');
    return Buffer.concat([header, prefix.subarray(newline + 1)]);
  } catch {
    return null;
  }
}

function writeRecoveredSessionFile(
  vaultPath: string,
  entry: SessionJournalEntryV1,
  lines: readonly string[],
  sourceAbsolute: string | null,
  recoveredTitle: string,
): string {
  const sessionDir = getPiviSessionDir(vaultPath);
  mkdirSync(sessionDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `recovered-${stamp}-${entry.id.slice(0, 12)}.jsonl`;
  const absolute = join(sessionDir, fileName);

  let body: Buffer;
  if (sourceAbsolute && existsSync(sourceAbsolute) && entry.baseFingerprint.size > 0) {
    const source = readFileSync(sourceAbsolute);
    if (prefixMatchesBase(sourceAbsolute, entry.baseFingerprint)) {
      const recoveredPrefix = rewriteRecoveredSessionHeader(
        source.subarray(0, entry.baseFingerprint.size),
        entry,
      );
      if (!recoveredPrefix) {
        body = buildRecoveredFromLinesOnly(source, lines, entry, recoveredTitle);
      } else {
        body = Buffer.concat([recoveredPrefix, Buffer.from(`${lines.join('\n')}\n`, 'utf8')]);
        const provenance = JSON.stringify({
          type: 'custom',
          id: `prov-${entry.id.slice(0, 12)}`,
          parentId: lastEntryIdInLines(lines)
            ?? lastEntryIdInPrefix(sourceAbsolute, entry.baseFingerprint.size),
          timestamp: new Date().toISOString(),
          customType: 'pivi/session-meta',
          data: {
            title: recoveredTitle,
            titleSource: 'custom',
            createdAt: entry.createdAt,
            recoverySourceSessionFile: entry.sessionFile,
            recoveryJournalEntryId: entry.id,
          },
        });
        body = Buffer.concat([body, Buffer.from(`${provenance}\n`, 'utf8')]);
      }
    } else {
      body = buildRecoveredFromLinesOnly(source, lines, entry, recoveredTitle);
    }
  } else {
    body = buildRecoveredFromLinesOnly(
      sourceAbsolute && existsSync(sourceAbsolute) ? readFileSync(sourceAbsolute) : null,
      lines,
      entry,
      recoveredTitle,
    );
  }

  writeAtomicFileSync(absolute, body);
  invalidateSessionJsonlIndex(absolute);
  return toVaultRelativePath(vaultPath, absolute);
}

function applyAppendLines(absoluteFile: string, baseSize: number, lines: readonly string[]): void {
  const expected = readFileSync(absoluteFile);
  if (expected.length !== baseSize) {
    throw new Error('Session changed before journal append could be applied');
  }
  writeAtomicFileSync(absoluteFile, Buffer.concat([
    expected,
    Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  ]));
  invalidateSessionJsonlIndex(absoluteFile);
}

function completeInterruptedAppend(
  absoluteFile: string,
  baseSize: number,
  lines: readonly string[],
): void {
  const expectedAppend = `${lines.join('\n')}\n`;
  const current = readFileSync(absoluteFile);
  const prefix = current.subarray(0, baseSize);
  writeAtomicFileSync(absoluteFile, Buffer.concat([
    prefix,
    Buffer.from(expectedAppend, 'utf8'),
  ]));
  invalidateSessionJsonlIndex(absoluteFile);
}

type SessionJournalState = ReturnType<SessionJournalStore['load']>;

function acknowledgeMatchingEntry(
  store: SessionJournalStore,
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
  classification: SessionDivergenceClassification,
): SessionRecoveryResult {
  // Confirmed evidence survives matching startups so a later cloud rollback
  // can still reconstruct this continuation.
  if (entry.status !== 'confirmed') {
    store.save(acknowledgeJournalEntry(state, entry.id));
  }
  return {
    classification,
    action: 'ack',
    noticeParams: { sessionFile: entry.sessionFile },
  };
}

/** Seal the entry with the lines now on disk and acknowledge it. */
function sealAndAcknowledge(
  store: SessionJournalStore,
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
  lines: string[],
  absolute: string,
): void {
  const sealed = upsertJournalEntry(state, sealJournalEntryWithAppend(
    entry, entry.entryIds ?? [], lines, captureSessionJsonlSource(absolute),
  ));
  store.save(acknowledgeJournalEntry(sealed, entry.id));
}

function reconcileUnacknowledged(
  vaultPath: string,
  store: SessionJournalStore,
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
  classification: SessionDivergenceClassification,
): SessionRecoveryResult {
  const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
  const lines = resolveAppendLines(entry)
    ?? observedAppendLines(absolute, entry.baseFingerprint.size);
  if (!lines) {
    return { classification, action: 'noop' };
  }
  sealAndAcknowledge(store, state, entry, lines, absolute);
  return {
    classification, action: 'ack', noticeKey: 'host.sessionRecovery.applied',
    noticeParams: { sessionFile: entry.sessionFile },
  };
}

function reconcileAppendCompatible(
  vaultPath: string,
  store: SessionJournalStore,
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
  classification: SessionDivergenceClassification,
): SessionRecoveryResult {
  const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
  const lines = resolveAppendLines(entry)
    ?? materializeIntentLines(entry, lastEntryIdInPrefix(absolute, entry.baseFingerprint.size));
  if (!lines || lines.length === 0) {
    return { classification, action: 'noop' };
  }
  applyAppendLines(absolute, entry.baseFingerprint.size, lines);
  sealAndAcknowledge(store, state, entry, lines, absolute);
  return {
    classification,
    action: 'apply_append',
    noticeKey: 'host.sessionRecovery.applied',
    noticeParams: { sessionFile: entry.sessionFile },
  };
}

function reconcileInterruptedAppend(
  vaultPath: string,
  store: SessionJournalStore,
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
  classification: SessionDivergenceClassification,
): SessionRecoveryResult {
  const lines = resolveAppendLines(entry);
  if (!lines) {
    return { classification, action: 'noop' };
  }
  const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
  completeInterruptedAppend(absolute, entry.baseFingerprint.size, lines);
  sealAndAcknowledge(store, state, entry, lines, absolute);
  return {
    classification,
    action: 'complete_interrupted',
    noticeKey: 'host.sessionRecovery.applied',
    noticeParams: { sessionFile: entry.sessionFile },
  };
}

/** Walk back through earlier entries of the same session whose result is the next entry's base. */
function collectRecoveryChain(
  state: SessionJournalState,
  entry: SessionJournalEntryV1,
): SessionJournalEntryV1[] {
  const selectedIndex = state.entries.findIndex((candidate) => candidate.id === entry.id);
  const chain = selectedIndex >= 0 ? [state.entries[selectedIndex]!] : [entry];
  for (let index = selectedIndex - 1; index >= 0; index--) {
    const candidate = state.entries[index]!;
    const next = chain[0]!;
    if (candidate.sessionFile !== entry.sessionFile) {
      continue;
    }
    if (!candidate.resultFingerprint
      || !fingerprintsContentEqual(candidate.resultFingerprint, next.baseFingerprint)) {
      break;
    }
    chain.unshift(candidate);
  }
  return chain;
}

function resolveRecoveryLines(
  vaultPath: string,
  entry: SessionJournalEntryV1,
  chain: readonly SessionJournalEntryV1[],
  kind: SessionDivergenceClassification['kind'],
): { recoveryEntry: SessionJournalEntryV1; lines: string[] | null } {
  const recoverableChain = chain
    .map((candidate) => ({ candidate, lines: resolveAppendLines(candidate) }))
    .filter((item): item is { candidate: SessionJournalEntryV1; lines: string[] } => !!item.lines);
  const recoveryEntry = recoverableChain[0]?.candidate ?? entry;
  let lines = recoverableChain.length > 0
    ? recoverableChain.flatMap((item) => item.lines)
    : resolveAppendLines(entry);
  if (!resolveAppendLines(entry) && kind === 'corrupt_tail') {
    const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
    const materialized = materializeIntentLines(
      entry,
      lastEntryIdInPrefix(absolute, entry.baseFingerprint.size),
    );
    if (materialized) {
      lines = [...(lines ?? []), ...materialized];
    }
  }
  return { recoveryEntry, lines };
}

function recoverDivergedSession(
  vaultPath: string,
  store: SessionJournalStore,
  initialState: SessionJournalState,
  entry: SessionJournalEntryV1,
  classification: SessionDivergenceClassification,
  recoveredTitle: string,
): SessionRecoveryResult {
  let state = initialState;
  const existing = state.recoveredIdentities[classification.divergenceId];
  if (existing && existsSync(toAbsoluteSessionPath(vaultPath, existing))) {
    store.save(removeJournalEntry(state, entry.id));
    return {
      classification,
      action: 'recovered_session',
      recoveredSessionFile: existing,
    };
  }
  const chain = collectRecoveryChain(state, entry);
  const { recoveryEntry, lines } = resolveRecoveryLines(vaultPath, entry, chain, classification.kind);
  if (!lines || lines.length === 0) {
    logger.warn('Journal entry lacks append lines for recovered session', {
      sessionFile: entry.sessionFile,
      journalEntryId: entry.id,
      kind: classification.kind,
    });
    return { classification, action: 'noop' };
  }
  const sourceAbsolute = existsSync(toAbsoluteSessionPath(vaultPath, entry.sessionFile))
    ? toAbsoluteSessionPath(vaultPath, entry.sessionFile)
    : null;
  const recovered = writeRecoveredSessionFile(
    vaultPath,
    recoveryEntry,
    lines,
    sourceAbsolute,
    recoveredTitle,
  );
  state = recordRecoveredIdentity(state, classification.divergenceId, recovered);
  for (const linked of chain) {
    state = removeJournalEntry(state, linked.id);
  }
  store.save(state);
  return {
    classification,
    action: 'recovered_session',
    recoveredSessionFile: recovered,
    noticeKey: 'host.sessionRecovery.recovered',
    noticeParams: {
      sessionFile: entry.sessionFile,
      recoveredSessionFile: recovered,
      reason: classification.kind,
    },
  };
}

export function reconcileJournalEntry(
  vaultPath: string,
  store: SessionJournalStore,
  entry: SessionJournalEntryV1,
  options?: { recoveredTitle?: string },
): SessionRecoveryResult {
  const classification = classifyJournalDivergence(vaultPath, entry);
  const state = store.load();

  switch (classification.kind) {
    case 'identical':
    case 'inode_only':
      return acknowledgeMatchingEntry(store, state, entry, classification);
    case 'unacknowledged':
      return reconcileUnacknowledged(vaultPath, store, state, entry, classification);
    case 'append_compatible':
      return reconcileAppendCompatible(vaultPath, store, state, entry, classification);
    case 'interrupted_append':
      return reconcileInterruptedAppend(vaultPath, store, state, entry, classification);
    case 'rollback':
    case 'truncation':
    case 'replacement':
    case 'corrupt_tail':
    case 'concurrent_append':
    case 'missing_source':
      return recoverDivergedSession(
        vaultPath,
        store,
        state,
        entry,
        classification,
        options?.recoveredTitle ?? 'Recovered session',
      );
    default:
      return { classification, action: 'noop' };
  }
}

export function reconcileSessionJournal(
  vaultPath: string,
  store: SessionJournalStore,
  options?: { recoveredTitle?: string },
): SessionRecoveryResult[] {
  const state = store.load();
  // Journal insertion order, reversed, lets one rolled-back tail recover its
  // complete chain without trusting wall clocks or creating partial duplicates.
  const active = listActiveJournalEntries(state).reverse();
  const results: SessionRecoveryResult[] = [];
  for (const entry of active) {
    if (!store.load().entries.some((current) => current.id === entry.id)) {
      continue;
    }
    try {
      results.push(reconcileJournalEntry(vaultPath, store, entry, options));
    } catch (error) {
      logger.warn('Session journal reconciliation failed for entry', {
        sessionFile: entry.sessionFile,
        journalEntryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
