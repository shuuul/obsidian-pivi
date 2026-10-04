/**
 * Classify how a session JSONL source diverged from a journal entry. Read-only:
 * recovery decisions and writes live in sessionRecovery.
 */

import {
  hashAppendLines,
  sessionDivergenceIdentity,
  type SessionJournalEntryV1,
  type SessionJsonlSourceFingerprint,
} from '@pivi/agent/session/sessionJournal';
import { toAbsoluteSessionPath } from '@pivi/agent/session/sessionPaths';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';

import { captureSessionJsonlSource } from './sessionJsonlIndex';

const FINGERPRINT_BYTES = 4096;

type SessionDivergenceKind =
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

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function fingerprintsContentEqual(
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

export function resolveAppendLines(entry: SessionJournalEntryV1): string[] | null {
  if (entry.appendLines && entry.appendLines.length > 0) {
    return [...entry.appendLines];
  }
  if (entry.intent.kind === 'jsonl-lines') {
    return [...entry.intent.lines];
  }
  return null;
}

export function lastEntryIdInPrefix(absolute: string, baseSize: number): string | null {
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

export function lastEntryIdInLines(lines: readonly string[]): string | null {
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

export function reparentFirstEntry(lines: readonly string[], parentId: string | null): string[] {
  if (lines.length === 0) return [];
  try {
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    return [JSON.stringify({ ...first, parentId }), ...lines.slice(1)];
  } catch {
    return [...lines];
  }
}

export function materializeIntentLines(
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

export function observedAppendLines(absolute: string, baseSize: number): string[] | null {
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

export function prefixMatchesBase(
  absoluteFile: string,
  base: SessionJsonlSourceFingerprint,
): boolean {
  const prefix = readSizedContentFingerprint(absoluteFile, base.size);
  return !!prefix
    && prefix.headSha256 === base.headSha256
    && prefix.tailSha256 === base.tailSha256;
}

function readAppendedText(absolute: string, baseSize: number): string {
  return readFileSync(absolute).subarray(baseSize).toString('utf8');
}

function extendsBase(
  absolute: string,
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
): boolean {
  return current.size > entry.baseFingerprint.size && prefixMatchesBase(absolute, entry.baseFingerprint);
}

function isInterruptedAppend(
  absolute: string,
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
  lines: string[] | null,
): boolean {
  if (!lines || !extendsBase(absolute, entry, current)) {
    return false;
  }
  const expectedAppend = `${lines.join('\n')}\n`;
  const actualAppend = readAppendedText(absolute, entry.baseFingerprint.size);
  // A torn write is expected to be malformed JSONL. Recognize only an exact
  // non-empty byte prefix so unrelated corruption is never repaired.
  return actualAppend.length > 0
    && actualAppend.length < expectedAppend.length
    && expectedAppend.startsWith(actualAppend);
}

function classifyByFingerprint(
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
): SessionDivergenceKind | null {
  if (entry.resultFingerprint && fingerprintsEqual(current, entry.resultFingerprint)) {
    return entry.status === 'confirmed' ? 'identical' : 'unacknowledged';
  }
  if (entry.resultFingerprint && fingerprintsContentEqual(current, entry.resultFingerprint)) {
    return 'inode_only';
  }
  if (fingerprintsContentEqual(current, entry.baseFingerprint)) {
    // A confirmed local write that disappeared from the synced file is rollback:
    // never re-apply onto the external source.
    return entry.status === 'confirmed' && entry.resultFingerprint ? 'rollback' : 'append_compatible';
  }
  return null;
}

function classifyAppendedTail(
  absolute: string,
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
  lines: string[] | null,
): SessionDivergenceKind | null {
  if (!extendsBase(absolute, entry, current)) {
    return null;
  }
  if (!lines) {
    return observedAppendLines(absolute, entry.baseFingerprint.size) ? 'unacknowledged' : null;
  }
  const expectedAppend = `${lines.join('\n')}\n`;
  const actualAppend = readAppendedText(absolute, entry.baseFingerprint.size);
  if (actualAppend === expectedAppend) {
    return 'unacknowledged';
  }
  if (actualAppend.startsWith(expectedAppend)) {
    return entry.status === 'confirmed' ? 'identical' : 'unacknowledged';
  }
  return 'concurrent_append';
}

function classifyShrunkSource(
  absolute: string,
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
): SessionDivergenceKind {
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
  return looksLikeRollback ? 'rollback' : 'truncation';
}

function classifyExistingSource(
  absolute: string,
  entry: SessionJournalEntryV1,
  current: SessionJsonlSourceFingerprint,
): SessionDivergenceKind {
  const lines = resolveAppendLines(entry);
  if (isInterruptedAppend(absolute, entry, current, lines)) {
    return 'interrupted_append';
  }
  if (!isValidJsonlFile(absolute)) {
    return 'corrupt_tail';
  }
  const kind = classifyByFingerprint(entry, current)
    ?? classifyAppendedTail(absolute, entry, current, lines);
  if (kind) {
    return kind;
  }
  return current.size < entry.baseFingerprint.size
    ? classifyShrunkSource(absolute, entry, current)
    : 'replacement';
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

  const classified = (
    kind: SessionDivergenceKind,
    currentFingerprint: SessionJsonlSourceFingerprint | null,
  ): SessionDivergenceClassification => ({
    kind,
    sessionFile: entry.sessionFile,
    entry,
    currentFingerprint,
    divergenceId,
  });

  if (!existsSync(absolute)) {
    return classified('missing_source', null);
  }

  let current: SessionJsonlSourceFingerprint;
  try {
    current = captureSessionJsonlSource(absolute);
  } catch {
    return classified('corrupt_tail', null);
  }

  return classified(classifyExistingSource(absolute, entry, current), current);
}
