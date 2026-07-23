/**
 * Classify and recover session JSONL / journal divergence without overwriting
 * an externally changed source or discarding a locally completed turn.
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { PluginLogger } from '../../../foundation/pluginLogger';
import {
  acknowledgeJournalEntry,
  hashAppendLines,
  listActiveJournalEntries,
  recordRecoveredIdentity,
  removeJournalEntry,
  sealJournalEntryWithAppend,
  sessionDivergenceIdentity,
  type SessionJournalEntryV1,
  type SessionJournalStore,
  type SessionJsonlSourceFingerprint,
  upsertJournalEntry,
} from '../../../session/sessionJournal';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '../../../session/sessionPaths';
import {
  captureSessionJsonlSource,
  invalidateSessionJsonlIndex,
} from './sessionJsonlIndex';

const logger = new PluginLogger('SessionRecovery');
const FINGERPRINT_BYTES = 4096;

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

export type SessionDivergenceKind =
  | 'identical'
  | 'inode_only'
  | 'append_compatible'
  | 'interrupted_append'
  | 'rollback'
  | 'truncation'
  | 'replacement'
  | 'corrupt_tail'
  | 'concurrent_append'
  | 'missing_source'
  | 'unacknowledged';

export interface SessionDivergenceClassification {
  kind: SessionDivergenceKind;
  sessionFile: string;
  entry: SessionJournalEntryV1;
  currentFingerprint: SessionJsonlSourceFingerprint | null;
  divergenceId: string;
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

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function fingerprintsContentEqual(
  a: SessionJsonlSourceFingerprint,
  b: SessionJsonlSourceFingerprint,
): boolean {
  return a.size === b.size
    && a.headSha256 === b.headSha256
    && a.tailSha256 === b.tailSha256;
}

function fingerprintsEqual(
  a: SessionJsonlSourceFingerprint,
  b: SessionJsonlSourceFingerprint,
): boolean {
  return fingerprintsContentEqual(a, b)
    && a.device === b.device
    && a.inode === b.inode
    && a.modifiedNs === b.modifiedNs;
}

function readSizedContentFingerprint(
  absoluteFile: string,
  size: number,
): Pick<SessionJsonlSourceFingerprint, 'size' | 'headSha256' | 'tailSha256'> | null {
  try {
    const content = readFileSync(absoluteFile);
    if (content.length < size) {
      return null;
    }
    const slice = content.subarray(0, size);
    return {
      size,
      headSha256: sha256(slice.subarray(0, Math.min(size, FINGERPRINT_BYTES))),
      tailSha256: sha256(slice.subarray(Math.max(0, size - FINGERPRINT_BYTES), size)),
    };
  } catch {
    return null;
  }
}

function resolveAppendLines(entry: SessionJournalEntryV1): string[] | null {
  if (entry.appendLines && entry.appendLines.length > 0) {
    return [...entry.appendLines];
  }
  if (entry.intent.kind === 'jsonl-lines') {
    return [...entry.intent.lines];
  }
  return null;
}

function lastEntryIdInPrefix(absolute: string, baseSize: number): string | null {
  const lines = readFileSync(absolute).subarray(0, baseSize).toString('utf8').trimEnd().split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index]!) as Record<string, unknown>;
      if (parsed.type !== 'session' && typeof parsed.id === 'string') {
        return parsed.id;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function lastEntryIdInLines(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index]!) as Record<string, unknown>;
      if (parsed.type !== 'session' && typeof parsed.id === 'string') {
        return parsed.id;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function reparentFirstEntry(lines: readonly string[], parentId: string | null): string[] {
  if (lines.length === 0) return [];
  try {
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    return [JSON.stringify({ ...first, parentId }), ...lines.slice(1)];
  } catch {
    return [...lines];
  }
}

function materializeIntentLines(
  entry: SessionJournalEntryV1,
  parentId: string | null,
): string[] | null {
  const timestamp = new Date(entry.createdAt).toISOString();
  const id = `journal-${entry.id.slice(0, 16)}`;
  const chain = (values: Record<string, unknown>[]): string[] => values.map((value, index) => JSON.stringify({
    ...value,
    id: values.length === 1 ? id : `${id}-${index}`,
    parentId: index === 0 ? parentId : `${id}-${index - 1}`,
    timestamp,
  }));
  switch (entry.intent.kind) {
    case 'user':
      return chain([{
        type: 'message',
        message: {
          role: 'user',
          content: entry.intent.images?.length
            ? [{ type: 'text', text: entry.intent.content }, ...entry.intent.images.map((image) => {
              const record = image as Record<string, unknown>;
              return {
                type: 'image',
                data: record.data,
                mimeType: record.mediaType ?? record.mimeType,
              };
            })]
            : entry.intent.content,
          timestamp: entry.createdAt,
        },
      }]);
    case 'agent':
      return chain(entry.intent.messages.map((message) => ({ type: 'message', message })));
    case 'custom':
      return chain([{
        type: 'custom',
        customType: entry.intent.customType, data: entry.intent.data,
      }]);
    case 'compaction':
      return chain([{
        type: 'compaction',
        summary: entry.intent.summary,
        firstKeptEntryId: entry.intent.firstKeptEntryId,
        tokensBefore: entry.intent.tokensBefore,
        ...(entry.intent.details ? { details: entry.intent.details } : {}),
      }]);
    case 'jsonl-lines':
      return [...entry.intent.lines];
    default:
      return null;
  }
}

function observedAppendLines(absolute: string, baseSize: number): string[] | null {
  const suffix = readFileSync(absolute).subarray(baseSize).toString('utf8');
  if (!suffix || !suffix.endsWith('\n')) {
    return null;
  }
  const lines = suffix.slice(0, -1).split('\n');
  try {
    lines.forEach((line) => {
      JSON.parse(line);
    });
    return lines;
  } catch {
    return null;
  }
}

function appendPayloadSha(entry: SessionJournalEntryV1): string {
  if (entry.appendSha256) {
    return entry.appendSha256;
  }
  const lines = resolveAppendLines(entry);
  if (lines) {
    return hashAppendLines(lines);
  }
  return createHash('sha256').update(JSON.stringify(entry.intent), 'utf8').digest('hex');
}

function isValidJsonlFile(absoluteFile: string): boolean {
  try {
    const content = readFileSync(absoluteFile);
    if (content.length === 0) {
      return false;
    }
    const text = content.toString('utf8');
    const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
    for (const line of lines) {
      if (!line) {
        return false;
      }
      JSON.parse(line);
    }
    return true;
  } catch {
    return false;
  }
}

function prefixMatchesBase(
  absoluteFile: string,
  base: SessionJsonlSourceFingerprint,
): boolean {
  const prefix = readSizedContentFingerprint(absoluteFile, base.size);
  return !!prefix
    && prefix.headSha256 === base.headSha256
    && prefix.tailSha256 === base.tailSha256;
}

export function classifyJournalDivergence(
  vaultPath: string,
  entry: SessionJournalEntryV1,
): SessionDivergenceClassification {
  const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
  const appendSha = appendPayloadSha(entry);
  const divergenceId = sessionDivergenceIdentity(
    entry.sessionFile,
    entry.baseFingerprint,
    appendSha,
  );

  if (!existsSync(absolute)) {
    return {
      kind: 'missing_source',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: null,
      divergenceId,
    };
  }

  let current: SessionJsonlSourceFingerprint;
  try {
    current = captureSessionJsonlSource(absolute);
  } catch {
    return {
      kind: 'corrupt_tail',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: null,
      divergenceId,
    };
  }

  const lines = resolveAppendLines(entry);
  if (lines && current.size > entry.baseFingerprint.size && prefixMatchesBase(absolute, entry.baseFingerprint)) {
    const expectedAppend = `${lines.join('\n')}\n`;
    const actualAppend = readFileSync(absolute)
      .subarray(entry.baseFingerprint.size)
      .toString('utf8');
    // A torn write is expected to be malformed JSONL. Recognize only an exact
    // non-empty byte prefix so unrelated corruption is never repaired.
    if (actualAppend.length > 0
      && actualAppend.length < expectedAppend.length
      && expectedAppend.startsWith(actualAppend)) {
      return {
        kind: 'interrupted_append', sessionFile: entry.sessionFile, entry,
        currentFingerprint: current, divergenceId,
      };
    }
  }

  if (!isValidJsonlFile(absolute)) {
    return {
      kind: 'corrupt_tail',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  if (entry.resultFingerprint && fingerprintsEqual(current, entry.resultFingerprint)) {
    return {
      kind: entry.status === 'confirmed' ? 'identical' : 'unacknowledged',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  if (entry.resultFingerprint && fingerprintsContentEqual(current, entry.resultFingerprint)) {
    return {
      kind: 'inode_only',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  if (fingerprintsContentEqual(current, entry.baseFingerprint)) {
    // A confirmed local write that disappeared from the synced file is rollback:
    // never re-apply onto the external source.
    if (entry.status === 'confirmed' && entry.resultFingerprint) {
      return {
        kind: 'rollback',
        sessionFile: entry.sessionFile,
        entry,
        currentFingerprint: current,
        divergenceId,
      };
    }
    return {
      kind: 'append_compatible',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  if (!lines && current.size > entry.baseFingerprint.size && prefixMatchesBase(absolute, entry.baseFingerprint)) {
    if (observedAppendLines(absolute, entry.baseFingerprint.size)) {
      return {
        kind: 'unacknowledged', sessionFile: entry.sessionFile, entry,
        currentFingerprint: current, divergenceId,
      };
    }
  }
  if (lines && current.size > entry.baseFingerprint.size && prefixMatchesBase(absolute, entry.baseFingerprint)) {
    const expectedAppend = `${lines.join('\n')}\n`;
    const actualAppend = readFileSync(absolute)
      .subarray(entry.baseFingerprint.size)
      .toString('utf8');
    if (actualAppend === expectedAppend) {
      return {
        kind: 'unacknowledged',
        sessionFile: entry.sessionFile,
        entry,
        currentFingerprint: current,
        divergenceId,
      };
    }
    if (actualAppend.startsWith(expectedAppend)) {
      return {
        kind: entry.status === 'confirmed' ? 'identical' : 'unacknowledged',
        sessionFile: entry.sessionFile,
        entry,
        currentFingerprint: current,
        divergenceId,
      };
    }
    return {
      kind: 'concurrent_append',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  if (current.size < entry.baseFingerprint.size) {
    const currentAsPrefix = readSizedContentFingerprint(absolute, current.size);
    const baseHead = entry.baseFingerprint.headSha256;
    const looksLikeRollback = !!currentAsPrefix
      && (
        current.size <= FINGERPRINT_BYTES
          ? currentAsPrefix.headSha256 === baseHead
            || current.headSha256 === sha256(
              readFileSync(absolute).subarray(0, Math.min(current.size, FINGERPRINT_BYTES)),
            )
          : current.headSha256 === baseHead
      );
    return {
      kind: looksLikeRollback ? 'rollback' : 'truncation',
      sessionFile: entry.sessionFile,
      entry,
      currentFingerprint: current,
      divergenceId,
    };
  }

  return {
    kind: 'replacement',
    sessionFile: entry.sessionFile,
    entry,
    currentFingerprint: current,
    divergenceId,
  };
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

export function reconcileJournalEntry(
  vaultPath: string,
  store: SessionJournalStore,
  entry: SessionJournalEntryV1,
  options?: { recoveredTitle?: string },
): SessionRecoveryResult {
  const classification = classifyJournalDivergence(vaultPath, entry);
  let state = store.load();

  const drop = (): void => {
    state = removeJournalEntry(state, entry.id);
    store.save(state);
  };

  switch (classification.kind) {
    case 'identical':
    case 'inode_only': {
      // Confirmed evidence survives matching startups so a later cloud rollback
      // can still reconstruct this continuation.
      if (entry.status !== 'confirmed') {
        state = acknowledgeJournalEntry(state, entry.id);
        store.save(state);
      }
      return {
        classification,
        action: 'ack',
        noticeParams: { sessionFile: entry.sessionFile },
      };
    }
    case 'unacknowledged': {
      const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
      const lines = resolveAppendLines(entry)
        ?? observedAppendLines(absolute, entry.baseFingerprint.size);
      if (!lines) {
        return { classification, action: 'noop' };
      }
      state = upsertJournalEntry(state, sealJournalEntryWithAppend(
        entry, entry.entryIds ?? [], lines, captureSessionJsonlSource(absolute),
      ));
      state = acknowledgeJournalEntry(state, entry.id);
      store.save(state);
      return {
        classification, action: 'ack', noticeKey: 'host.sessionRecovery.applied',
        noticeParams: { sessionFile: entry.sessionFile },
      };
    }
    case 'append_compatible': {
      const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
      const lines = resolveAppendLines(entry)
        ?? materializeIntentLines(entry, lastEntryIdInPrefix(absolute, entry.baseFingerprint.size));
      if (!lines || lines.length === 0) {
        return { classification, action: 'noop' };
      }
      applyAppendLines(absolute, entry.baseFingerprint.size, lines);
      const resultFp = captureSessionJsonlSource(absolute);
      state = upsertJournalEntry(
        state,
        sealJournalEntryWithAppend(entry, entry.entryIds ?? [], lines, resultFp),
      );
      state = acknowledgeJournalEntry(state, entry.id);
      store.save(state);
      return {
        classification,
        action: 'apply_append',
        noticeKey: 'host.sessionRecovery.applied',
        noticeParams: { sessionFile: entry.sessionFile },
      };
    }
    case 'interrupted_append': {
      const lines = resolveAppendLines(entry);
      if (!lines) {
        return { classification, action: 'noop' };
      }
      const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
      completeInterruptedAppend(absolute, entry.baseFingerprint.size, lines);
      const completed = captureSessionJsonlSource(absolute);
      state = upsertJournalEntry(state, sealJournalEntryWithAppend(
        entry, entry.entryIds ?? [], lines, completed,
      ));
      state = acknowledgeJournalEntry(state, entry.id);
      store.save(state);
      return {
        classification,
        action: 'complete_interrupted',
        noticeKey: 'host.sessionRecovery.applied',
        noticeParams: { sessionFile: entry.sessionFile },
      };
    }
    case 'rollback':
    case 'truncation':
    case 'replacement':
    case 'corrupt_tail':
    case 'concurrent_append':
    case 'missing_source': {
      const existing = state.recoveredIdentities[classification.divergenceId];
      if (existing) {
        const existingAbsolute = toAbsoluteSessionPath(vaultPath, existing);
        if (existsSync(existingAbsolute)) {
          drop();
          return {
            classification,
            action: 'recovered_session',
            recoveredSessionFile: existing,
          };
        }
      }
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
      const recoverableChain = chain
        .map((candidate) => ({ candidate, lines: resolveAppendLines(candidate) }))
        .filter((item): item is { candidate: SessionJournalEntryV1; lines: string[] } => !!item.lines);
      const recoveryEntry = recoverableChain[0]?.candidate ?? entry;
      let lines = recoverableChain.length > 0
        ? recoverableChain.flatMap((item) => item.lines)
        : resolveAppendLines(entry);
      if (!resolveAppendLines(entry) && classification.kind === 'corrupt_tail') {
        const absolute = toAbsoluteSessionPath(vaultPath, entry.sessionFile);
        const materialized = materializeIntentLines(
          entry,
          lastEntryIdInPrefix(absolute, entry.baseFingerprint.size),
        );
        if (materialized) {
          lines = [...(lines ?? []), ...materialized];
        }
      }
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
        options?.recoveredTitle ?? 'Recovered session',
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
    default: {
      return { classification, action: 'noop' };
    }
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
