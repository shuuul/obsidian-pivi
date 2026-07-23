/**
 * Device-local write-ahead journal for session JSONL continuation.
 * Records the minimum data needed to preserve a locally completed turn across
 * cloud replacement/rollback without storing credentials or absolute paths.
 */

import { createHash } from 'crypto';

/** Bounded source identity shared by the JSONL index and the session journal. */
export interface SessionJsonlSourceFingerprint {
  size: number;
  device: string;
  inode: string;
  modifiedNs: string;
  headSha256: string;
  tailSha256: string;
}

export const SESSION_JOURNAL_VERSION = 1 as const;

/** Maximum retained pending/intent entries across all sessions. */
export const SESSION_JOURNAL_MAX_ENTRIES = 64;

/** Maximum UTF-8 bytes for a single entry's appendLines + intent payload. */
export const SESSION_JOURNAL_MAX_ENTRY_BYTES = 1_500_000;

/**
 * `intent` — recorded before/around a local append.
 * `pending` — append bytes sealed; not yet confirmed against a stable source.
 * `confirmed` — JSONL append succeeded on this device; retained until a newer
 *   confirmed entry for the same session supersedes it or startup verifies the
 *   source still matches (so post-ack cloud rollback remains recoverable).
 */
export type SessionJournalEntryStatus = 'intent' | 'pending' | 'confirmed';

/**
 * Opaque continuation payload already permitted in session JSONL.
 * Absolute external paths must be stripped before journaling.
 */
export type SessionJournalIntent =
  | {
    kind: 'user';
    content: string;
    /** Data-URL or vault-relative image payloads already accepted by session writes. */
    images?: readonly unknown[];
  }
  | {
    kind: 'agent';
    messages: readonly Record<string, unknown>[];
  }
  | {
    kind: 'custom';
    customType: string;
    data: Record<string, unknown>;
  }
  | {
    kind: 'compaction';
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: Record<string, unknown>;
  }
  | {
    kind: 'jsonl-lines';
    lines: readonly string[];
  };

export interface SessionJournalEntryV1 {
  version: typeof SESSION_JOURNAL_VERSION;
  id: string;
  sessionFile: string;
  createdAt: number;
  status: SessionJournalEntryStatus;
  baseFingerprint: SessionJsonlSourceFingerprint;
  intent: SessionJournalIntent;
  entryIds?: string[];
  appendLines?: string[];
  appendSha256?: string;
  resultFingerprint?: SessionJsonlSourceFingerprint;
}

export interface SessionJournalStateV1 {
  version: typeof SESSION_JOURNAL_VERSION;
  entries: SessionJournalEntryV1[];
  /**
   * Maps divergence identity → vault-relative recovered session file.
   * Prevents duplicate recovered sessions across repeated startups.
   */
  recoveredIdentities: Record<string, string>;
}

export interface SessionJournalStore {
  load(): SessionJournalStateV1;
  save(state: SessionJournalStateV1): void;
}

export class SessionJournalVersionError extends Error {
  constructor(unsupportedVersion: unknown) {
    super(`Unsupported session journal version: ${String(unsupportedVersion)}`);
    this.name = 'SessionJournalVersionError';
  }
}

export class SessionJournalBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionJournalBoundsError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFingerprint(value: unknown): value is SessionJsonlSourceFingerprint {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.size === 'number'
    && Number.isSafeInteger(value.size)
    && value.size >= 0
    && typeof value.device === 'string'
    && typeof value.inode === 'string'
    && typeof value.modifiedNs === 'string'
    && typeof value.headSha256 === 'string'
    && typeof value.tailSha256 === 'string';
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function estimateEntryBytes(entry: SessionJournalEntryV1): number {
  return Buffer.byteLength(JSON.stringify(entry), 'utf8');
}

function normalizeIntent(raw: unknown): SessionJournalIntent | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return null;
  }
  switch (raw.kind) {
    case 'user': {
      if (typeof raw.content !== 'string') {
        return null;
      }
      return {
        kind: 'user',
        content: raw.content,
        ...(Array.isArray(raw.images) ? { images: raw.images as unknown[] } : {}),
      };
    }
    case 'agent': {
      if (!Array.isArray(raw.messages)) {
        return null;
      }
      const messages = raw.messages.filter(isRecord);
      if (messages.length !== raw.messages.length) {
        return null;
      }
      return { kind: 'agent', messages };
    }
    case 'custom': {
      if (typeof raw.customType !== 'string' || !isRecord(raw.data)) {
        return null;
      }
      return { kind: 'custom', customType: raw.customType, data: { ...raw.data } };
    }
    case 'compaction': {
      if (
        typeof raw.summary !== 'string'
        || typeof raw.firstKeptEntryId !== 'string'
        || typeof raw.tokensBefore !== 'number'
      ) {
        return null;
      }
      return {
        kind: 'compaction',
        summary: raw.summary,
        firstKeptEntryId: raw.firstKeptEntryId,
        tokensBefore: raw.tokensBefore,
        ...(isRecord(raw.details) ? { details: { ...raw.details } } : {}),
      };
    }
    case 'jsonl-lines': {
      if (!Array.isArray(raw.lines) || !raw.lines.every((line) => typeof line === 'string')) {
        return null;
      }
      return { kind: 'jsonl-lines', lines: raw.lines };
    }
    default:
      return null;
  }
}

function normalizeEntry(raw: unknown): SessionJournalEntryV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.version !== SESSION_JOURNAL_VERSION) {
    return null;
  }
  if (typeof raw.id !== 'string'
    || typeof raw.sessionFile !== 'string'
    || typeof raw.createdAt !== 'number'
    || (raw.status !== 'intent' && raw.status !== 'pending' && raw.status !== 'confirmed'
      && raw.status !== 'acknowledged')
    || !isFingerprint(raw.baseFingerprint)) {
    return null;
  }
  const intent = normalizeIntent(raw.intent);
  if (!intent) {
    return null;
  }
  const status: SessionJournalEntryStatus = raw.status === 'acknowledged'
    ? 'confirmed'
    : raw.status;
  const entry: SessionJournalEntryV1 = {
    version: SESSION_JOURNAL_VERSION,
    id: raw.id,
    sessionFile: raw.sessionFile,
    createdAt: raw.createdAt,
    status,
    baseFingerprint: raw.baseFingerprint,
    intent,
  };
  if (Array.isArray(raw.entryIds) && raw.entryIds.every((id) => typeof id === 'string')) {
    entry.entryIds = raw.entryIds;
  }
  if (Array.isArray(raw.appendLines) && raw.appendLines.every((line) => typeof line === 'string')) {
    entry.appendLines = raw.appendLines;
  }
  if (typeof raw.appendSha256 === 'string') {
    entry.appendSha256 = raw.appendSha256;
  }
  if (isFingerprint(raw.resultFingerprint)) {
    entry.resultFingerprint = raw.resultFingerprint;
  }
  return entry;
}

export function emptySessionJournalState(): SessionJournalStateV1 {
  return {
    version: SESSION_JOURNAL_VERSION,
    entries: [],
    recoveredIdentities: {},
  };
}

export function normalizeSessionJournalState(raw: unknown): SessionJournalStateV1 {
  if (!raw) {
    return emptySessionJournalState();
  }
  if (!isRecord(raw)) {
    return emptySessionJournalState();
  }
  if (raw.version !== undefined && raw.version !== SESSION_JOURNAL_VERSION) {
    throw new SessionJournalVersionError(raw.version);
  }
  const entries: SessionJournalEntryV1[] = [];
  if (Array.isArray(raw.entries)) {
    for (const item of raw.entries) {
      const entry = normalizeEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
  }
  const recoveredIdentities: Record<string, string> = {};
  if (isRecord(raw.recoveredIdentities)) {
    for (const [key, value] of Object.entries(raw.recoveredIdentities)) {
      if (typeof value === 'string' && value.length > 0) {
        recoveredIdentities[key] = value;
      }
    }
  }
  return {
    version: SESSION_JOURNAL_VERSION,
    entries,
    recoveredIdentities,
  };
}

export function assertSupportedSessionJournalVersion(version: unknown): void {
  if (version !== undefined && version !== SESSION_JOURNAL_VERSION) {
    throw new SessionJournalVersionError(version);
  }
}

export function hashAppendLines(lines: readonly string[]): string {
  return sha256Text(lines.join('\n'));
}

/** Stable identity for one divergence between a journaled turn and an external source. */
export function sessionDivergenceIdentity(
  sessionFile: string,
  baseFingerprint: SessionJsonlSourceFingerprint,
  appendSha256: string,
): string {
  return sha256Text([
    sessionFile,
    String(baseFingerprint.size),
    baseFingerprint.headSha256,
    baseFingerprint.tailSha256,
    appendSha256,
  ].join(':'));
}

export function createJournalEntryId(
  sessionFile: string,
  baseFingerprint: SessionJsonlSourceFingerprint,
  intent: SessionJournalIntent,
  createdAt: number,
): string {
  return sha256Text([
    sessionFile,
    String(baseFingerprint.size),
    baseFingerprint.headSha256,
    baseFingerprint.tailSha256,
    JSON.stringify(intent),
    String(createdAt),
  ].join(':'));
}

function compactEntries(entries: readonly SessionJournalEntryV1[]): SessionJournalEntryV1[] {
  if (entries.length <= SESSION_JOURNAL_MAX_ENTRIES) {
    return [...entries];
  }
  return entries.slice(entries.length - SESSION_JOURNAL_MAX_ENTRIES);
}

export function upsertJournalEntry(
  state: SessionJournalStateV1,
  entry: SessionJournalEntryV1,
): SessionJournalStateV1 {
  if (estimateEntryBytes(entry) > SESSION_JOURNAL_MAX_ENTRY_BYTES) {
    throw new SessionJournalBoundsError(
      `Session journal entry exceeds ${SESSION_JOURNAL_MAX_ENTRY_BYTES} bytes`,
    );
  }
  const remaining = state.entries.filter((existing) => existing.id !== entry.id);
  return {
    ...state,
    entries: compactEntries([...remaining, entry]),
  };
}

/** Mark a sealed append as device-confirmed while retaining it for rollback recovery. */
export function acknowledgeJournalEntry(
  state: SessionJournalStateV1,
  entryId: string,
): SessionJournalStateV1 {
  const entries = state.entries.map((entry) => (
    entry.id === entryId
      ? { ...entry, status: 'confirmed' as const }
      : entry
  ));
  const confirmed = entries.find((entry) => entry.id === entryId && entry.status === 'confirmed');
  if (!confirmed) {
    return { ...state, entries };
  }
  // One confirmed continuation per session is enough; drop older confirmed rows.
  const pruned = entries.filter((entry) => (
    entry.id === confirmed.id
    || entry.sessionFile !== confirmed.sessionFile
    || entry.status !== 'confirmed'
  ));
  return {
    ...state,
    entries: compactEntries(pruned),
  };
}

/** Remove a journal entry after startup proves the source still matches. */
export function removeJournalEntry(
  state: SessionJournalStateV1,
  entryId: string,
): SessionJournalStateV1 {
  return {
    ...state,
    entries: state.entries.filter((entry) => entry.id !== entryId),
  };
}

export function recordRecoveredIdentity(
  state: SessionJournalStateV1,
  divergenceId: string,
  recoveredSessionFile: string,
): SessionJournalStateV1 {
  if (state.recoveredIdentities[divergenceId] === recoveredSessionFile) {
    return state;
  }
  return {
    ...state,
    recoveredIdentities: {
      ...state.recoveredIdentities,
      [divergenceId]: recoveredSessionFile,
    },
  };
}

export function listActiveJournalEntries(
  state: SessionJournalStateV1,
  sessionFile?: string,
): SessionJournalEntryV1[] {
  return state.entries.filter((entry) => (
    sessionFile === undefined || entry.sessionFile === sessionFile
  ));
}

export function sealJournalEntryWithAppend(
  entry: SessionJournalEntryV1,
  entryIds: readonly string[],
  appendLines: readonly string[],
  resultFingerprint: SessionJsonlSourceFingerprint,
): SessionJournalEntryV1 {
  const appendSha256 = hashAppendLines(appendLines);
  return {
    ...entry,
    status: 'pending',
    entryIds: [...entryIds],
    appendLines: [...appendLines],
    appendSha256,
    resultFingerprint,
    intent: entry.intent.kind === 'jsonl-lines'
      ? entry.intent
      : { kind: 'jsonl-lines', lines: [...appendLines] },
  };
}
