/** Stateless helpers for SessionTreeStore: journal binding, fork compensation, ranged reads, and persisted async-subagent results. */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  SessionManager} from '@earendil-works/pi-coding-agent';
import {
  type SessionEntry
} from '@earendil-works/pi-coding-agent';
import {
  type AgentReport,
  formatAgentReportForParent,
  parseAgentReport,
} from '@pivi/agent/session/continuationSchemas';
import {
  acknowledgeJournalEntry,
  createJournalEntryId,
  sealJournalEntryWithAppend,
  type SessionJournalEntryV1,
  type SessionJournalStore,
  type SessionJsonlSourceFingerprint,
  upsertJournalEntry,
} from '@pivi/agent/session/sessionJournal';
import {
  getPiviSessionDir,
  InvalidSessionFileError,
  isCanonicalVaultRelativeJsonl,
} from '@pivi/agent/session/sessionPaths';
import {
  PIVI_MESSAGE_UI,
  type PiviMessageUiData,
} from '@pivi/agent/session/types';
import {
  closeSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from 'fs';
import {
  basename,
  dirname,
  resolve,
} from 'path';

export interface BoundSessionJournal {
  store: SessionJournalStore;
  now: () => number;
  owner: symbol;
}

let boundJournal: BoundSessionJournal | null = null;

/** The journal bound by the current application instance, with its clock. */
export function getBoundJournalBinding(): BoundSessionJournal | null {
  return boundJournal;
}

export interface SessionJournalBinding {
  /** Releases only this binding; returns false after replacement or prior release. */
  release(): boolean;
}

/** Bind the vault-scoped device-local session journal used by live appends. */
export function bindSessionJournal(
  store: SessionJournalStore | null,
  now: () => number = () => Date.now(),
): SessionJournalBinding {
  const owner = Symbol('session-journal-owner');
  boundJournal = store ? { store, now, owner } : null;
  return {
    release() {
      if (boundJournal?.owner !== owner) return false;
      boundJournal = null;
      return true;
    },
  };
}

export function getBoundSessionJournal(): SessionJournalStore | null {
  return boundJournal?.store ?? null;
}

export function cacheKey(vaultPath: string, sessionFile: string): string {
  return `${vaultPath}::${sessionFile}`;
}

/**
 * Restored tab/session identity must be a canonical vault-relative `.jsonl`
 * path. The trash mirror is still relative, so the prefix is not required here;
 * absolute, traversal, and non-JSONL shapes are rejected before any open.
 */
export function requireVaultSessionFile(sessionFile: string): void {
  if (!isCanonicalVaultRelativeJsonl(sessionFile)) {
    throw new InvalidSessionFileError(sessionFile);
  }
}

/**
 * Read `[offset, offset+length)` by byte offset. Journal seals are UTF-8 JSONL
 * continuations, so this must return the exact bytes rather than a string slice.
 */
function readFileRangeSync(file: string, offset: number, length: number): Buffer {
  if (length === 0) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.allocUnsafe(length);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, 'r');
    const read = readSync(descriptor, buffer, 0, length, offset);
    if (read !== length) {
      throw new Error(`Session continuation ended early at byte ${offset + read}`);
    }
    return buffer;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function removePartialFork(vaultPath: string, candidate: string): void {
  const absoluteCandidate = resolve(candidate);
  const sessionDirectory = resolve(getPiviSessionDir(vaultPath));
  if (
    dirname(absoluteCandidate) !== sessionDirectory
    || !basename(absoluteCandidate).endsWith('.jsonl')
  ) {
    throw new Error(`Refusing to remove unexpected partial fork path: ${candidate}`);
  }
  rmSync(absoluteCandidate, { force: true });
}

export function createBranchedSessionWithCompensation(
  vaultPath: string,
  manager: SessionManager,
  atEntryId: string,
): string | null {
  const source = manager.getSessionFile();
  try {
    return manager.createBranchedSession(atEntryId) ?? null;
  } catch (primaryError) {
    const candidate = manager.getSessionFile();
    if (!candidate || (source && resolve(candidate) === resolve(source))) throw primaryError;
    try {
      removePartialFork(vaultPath, candidate);
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `Session fork failed and left a partial file at ${candidate}`,
      );
    }
    throw primaryError;
  }
}

export function isLlmContextEntry(entry: SessionEntry): boolean {
  return entry.type === 'message' || entry.type === 'compaction';
}

interface AsyncSubagentPersistedResult {
  agentId?: string;
  status: 'completed' | 'error';
  result: string;
  report?: AgentReport;
}

function collectPersistedAsyncSubagentResults(
  entries: SessionEntry[],
): Map<string, AsyncSubagentPersistedResult> {
  const results = new Map<string, AsyncSubagentPersistedResult>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== PIVI_MESSAGE_UI) {
      continue;
    }
    const data = entry.data as PiviMessageUiData | undefined;
    for (const toolCall of data?.toolCalls ?? []) {
      const subagent = toolCall.subagent;
      if (!subagent || subagent.mode !== 'async') {
        continue;
      }
      const status = subagent.asyncStatus ?? subagent.status;
      if (status !== 'completed' && status !== 'error') {
        continue;
      }
      const result = subagent.result?.trim() || toolCall.result?.trim();
      if (!result) {
        continue;
      }
      const report = parseAgentReport(toolCall.toolUseResult?.agent_report);
      results.set(toolCall.id, {
        agentId: subagent.agentId,
        status,
        result,
        ...(report ? { report } : {}),
      });
    }
  }
  return results;
}

function formatPersistedAsyncSubagentResult(result: AsyncSubagentPersistedResult): string {
  const statusText = result.status === 'error' ? 'failed' : 'completed';
  const header = result.agentId
    ? `Background sub-agent ${result.agentId} ${statusText}.`
    : `Background sub-agent ${statusText}.`;
  return `${header}\n\n${result.report
    ? formatAgentReportForParent(result.report)
    : result.result}`;
}

export function applyPersistedAsyncSubagentResults(
  messages: AgentMessage[],
  entries: SessionEntry[],
): AgentMessage[] {
  const results = collectPersistedAsyncSubagentResults(entries);
  if (results.size === 0) {
    return messages;
  }

  let changed = false;
  const next = messages.map((message) => {
    const record = message as unknown as Record<string, unknown>;
    if (record.role !== 'toolResult' || record.toolName !== 'spawn_agent') {
      return message;
    }
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
    const result = toolCallId ? results.get(toolCallId) : undefined;
    if (!result) {
      return message;
    }
    changed = true;
    return {
      ...record,
      content: [{ type: 'text', text: formatPersistedAsyncSubagentResult(result) }],
      isError: result.status === 'error',
    } as unknown as AgentMessage;
  });

  return changed ? next : messages;
}

/**
 * Seal the bytes appended after `baseFingerprint` into the journal and confirm them.
 * A source that shrank or gained nothing leaves the journal untouched.
 */
export function sealAppendedContinuation(
  journal: BoundSessionJournal,
  append: {
    absoluteSessionFile: string;
    relativeSessionFile: string;
    baseFingerprint: SessionJsonlSourceFingerprint;
    resultFingerprint: SessionJsonlSourceFingerprint;
    entryIds: readonly string[];
    journalEntry?: SessionJournalEntryV1;
  },
): void {
  const { absoluteSessionFile, relativeSessionFile, baseFingerprint, entryIds, journalEntry } = append;
  const baseSize = baseFingerprint.size;
  const currentSize = statSync(absoluteSessionFile).size;
  if (currentSize < baseSize) {
    return;
  }
  // Read only the continuation. Re-reading the whole JSONL on every append
  // copies megabytes that the journal never stores.
  const appended = readFileRangeSync(
    absoluteSessionFile,
    baseSize,
    currentSize - baseSize,
  ).toString('utf8');
  if (!appended) {
    return;
  }
  const lines = appended.endsWith('\n')
    ? appended.slice(0, -1).split('\n')
    : appended.split('\n');
  const createdAt = journalEntry?.createdAt ?? journal.now();
  const intent = journalEntry?.intent ?? { kind: 'jsonl-lines' as const, lines };
  const id = journalEntry?.id ?? createJournalEntryId(
    relativeSessionFile, baseFingerprint, intent, createdAt,
  );
  const sealed = sealJournalEntryWithAppend(
    journalEntry ?? {
      version: 1,
      id,
      sessionFile: relativeSessionFile,
      createdAt,
      status: 'intent',
      baseFingerprint,
      intent,
    },
    entryIds,
    lines,
    append.resultFingerprint,
  );
  let state = journal.store.load();
  state = upsertJournalEntry(state, sealed);
  // Persist pending before confirmation so a crash mid-ack remains recoverable.
  journal.store.save(state);
  state = acknowledgeJournalEntry(state, id);
  journal.store.save(state);
}
