import {
  CURRENT_SESSION_VERSION,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { createHash } from 'crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';

import {
  PIVI_MESSAGE_UI,
  PIVI_UI_CONTEXT,
  SessionIndexCorruptError,
  SessionIndexError,
  SessionIndexStaleError,
} from '../../../session/types';
import {
  hashDurableUserContent,
  hashVisibleUserText,
} from './sessionMessageProjection';

const INDEX_VERSION = 2;
const FINGERPRINT_BYTES = 4096;
const INDEX_SUFFIX = '.pivi-index';

export interface SessionJsonlSourceFingerprint {
  size: number;
  device: string;
  inode: string;
  modifiedNs: string;
  headSha256: string;
  tailSha256: string;
}

interface IndexFormatRecord {
  kind: 'index';
  version: typeof INDEX_VERSION;
}

export interface SessionJsonlIndexLine {
  kind: 'line';
  lineKind: 'header' | 'entry';
  id: string;
  entryType: string;
  customType?: string;
  role?: string;
  targetEntryId?: string;
  userTextSha256?: string;
  targetDisplayTextSha256?: string;
  hasLegacyExternalContext?: true;
  offset: number;
  length: number;
  sha256: string;
}

interface IndexCheckpointRecord {
  kind: 'checkpoint';
  source: SessionJsonlSourceFingerprint;
  lineChainSha256: string;
  migrations: SessionJsonlIndexMigrations;
}

type IndexRecord = IndexFormatRecord | SessionJsonlIndexLine | IndexCheckpointRecord;

export interface SessionJsonlIndex {
  readonly sessionFile: string;
  readonly indexFile: string;
  readonly header: SessionJsonlIndexLine;
  readonly entries: readonly SessionJsonlIndexLine[];
  readonly source: Readonly<SessionJsonlSourceFingerprint>;
  readonly migrations: Readonly<SessionJsonlIndexMigrations>;
}

export interface SessionJsonlIndexMigrations {
  externalContexts: 0 | 1;
}

interface MutableSessionJsonlIndex {
  sessionFile: string;
  indexFile: string;
  header: SessionJsonlIndexLine;
  entries: SessionJsonlIndexLine[];
  source: SessionJsonlSourceFingerprint;
  lineChainSha256: string;
  migrations: SessionJsonlIndexMigrations;
}

interface BigIntStats {
  size: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
}

const indexCache = new Map<string, MutableSessionJsonlIndex>();

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function extendLineChain(
  previous: string,
  lines: readonly SessionJsonlIndexLine[],
): string {
  let chain = previous;
  for (const line of lines) {
    chain = sha256(Buffer.from(`${chain}:${JSON.stringify(line)}`));
  }
  return chain;
}

function stats(file: string): BigIntStats {
  try {
    return statSync(file, { bigint: true });
  } catch (error) {
    throw new SessionIndexStaleError('Session file metadata is unavailable', file, { cause: error });
  }
}

function statsIdentity(value: BigIntStats): string {
  return [value.size, value.dev, value.ino, value.mtimeNs].join(':');
}

function readSlice(file: string, offset: number, length: number): Buffer {
  if (length === 0) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.allocUnsafe(length);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, 'r');
    const read = readSync(descriptor, buffer, 0, length, offset);
    if (read !== length) {
      throw new SessionIndexStaleError(
        `Indexed session range ended early at byte ${offset + read}`,
        file,
      );
    }
    return buffer;
  } catch (error) {
    if (error instanceof SessionIndexError) {
      throw error;
    }
    throw new SessionIndexStaleError(`Indexed session range is unavailable at byte ${offset}`, file, {
      cause: error,
    });
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function fingerprintFromBuffer(
  fileStats: BigIntStats,
  content: Buffer,
): SessionJsonlSourceFingerprint {
  const size = Number(fileStats.size);
  const head = content.subarray(0, Math.min(size, FINGERPRINT_BYTES));
  const tail = content.subarray(Math.max(0, size - FINGERPRINT_BYTES), size);
  return {
    size,
    device: fileStats.dev.toString(),
    inode: fileStats.ino.toString(),
    modifiedNs: fileStats.mtimeNs.toString(),
    headSha256: sha256(head),
    tailSha256: sha256(tail),
  };
}

function readStableFingerprint(file: string): SessionJsonlSourceFingerprint {
  try {
    const before = stats(file);
    const size = Number(before.size);
    const head = readSlice(file, 0, Math.min(size, FINGERPRINT_BYTES));
    const tailOffset = Math.max(0, size - FINGERPRINT_BYTES);
    const tail = readSlice(file, tailOffset, size - tailOffset);
    const after = stats(file);
    if (statsIdentity(before) !== statsIdentity(after)) {
      throw new SessionIndexStaleError('Session changed while its index was being validated', file);
    }
    return {
      size,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      modifiedNs: before.mtimeNs.toString(),
      headSha256: sha256(head),
      tailSha256: sha256(tail),
    };
  } catch (error) {
    if (error instanceof SessionIndexError) {
      throw error;
    }
    throw new SessionIndexStaleError('Session file is unavailable for index validation', file, {
      cause: error,
    });
  }
}

function fingerprintsEqual(
  a: SessionJsonlSourceFingerprint,
  b: SessionJsonlSourceFingerprint,
): boolean {
  return a.size === b.size
    && a.device === b.device
    && a.inode === b.inode
    && a.modifiedNs === b.modifiedNs
    && a.headSha256 === b.headSha256
    && a.tailSha256 === b.tailSha256;
}

function parseJsonObject(raw: Buffer, sessionFile: string, offset: number): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('line is not an object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new SessionIndexCorruptError(
      `Invalid session JSONL at byte ${offset}`,
      sessionFile,
      { cause: error },
    );
  }
}

function scanJsonlLines(
  content: Buffer,
  sessionFile: string,
  baseOffset: number,
  includeHeader: boolean,
): SessionJsonlIndexLine[] {
  const lines: SessionJsonlIndexLine[] = [];
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf(0x0a, lineStart);
    const lineEnd = newline >= 0 ? newline : content.length;
    const raw = content.subarray(lineStart, lineEnd);
    if (raw.length === 0) {
      throw new SessionIndexCorruptError(
        `Empty session JSONL line at byte ${baseOffset + lineStart}`,
        sessionFile,
      );
    }
    const parsed = parseJsonObject(raw, sessionFile, baseOffset + lineStart);
    const isHeader = includeHeader && lines.length === 0;
    if (isHeader) {
      if (parsed.type !== 'session' || typeof parsed.id !== 'string') {
        throw new SessionIndexCorruptError('Session JSONL does not start with a valid header', sessionFile);
      }
    } else if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
      throw new SessionIndexCorruptError(
        `Session entry at byte ${baseOffset + lineStart} is missing type or id`,
        sessionFile,
      );
    }
    const message = parsed.message && typeof parsed.message === 'object' && !Array.isArray(parsed.message)
      ? parsed.message as Record<string, unknown>
      : undefined;
    const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
      ? parsed.data as Record<string, unknown>
      : undefined;
    const turnRequest = data?.turnRequest
      && typeof data.turnRequest === 'object'
      && !Array.isArray(data.turnRequest)
      ? data.turnRequest as Record<string, unknown>
      : undefined;
    const hasLegacyExternalContext = (
      parsed.customType === PIVI_UI_CONTEXT
      && Object.hasOwn(data ?? {}, 'externalContextPaths')
    ) || (
      parsed.customType === PIVI_MESSAGE_UI
      && Object.hasOwn(turnRequest ?? {}, 'externalContextPaths')
    );
    lines.push({
      kind: 'line',
      lineKind: isHeader ? 'header' : 'entry',
      id: parsed.id,
      entryType: parsed.type,
      ...(typeof parsed.customType === 'string' ? { customType: parsed.customType } : {}),
      ...(typeof message?.role === 'string' ? { role: message.role } : {}),
      ...(typeof data?.targetEntryId === 'string' ? { targetEntryId: data.targetEntryId } : {}),
      ...(message?.role === 'user'
        ? { userTextSha256: hashDurableUserContent(message.content) }
        : {}),
      ...(parsed.customType === PIVI_MESSAGE_UI && typeof data?.displayContent === 'string'
        ? { targetDisplayTextSha256: hashVisibleUserText(data.displayContent) }
        : {}),
      ...(hasLegacyExternalContext ? { hasLegacyExternalContext: true as const } : {}),
      offset: baseOffset + lineStart,
      length: raw.length,
      sha256: sha256(raw),
    });
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }
  return lines;
}

function serializeRecords(records: readonly IndexRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function isIndexLine(value: unknown): value is SessionJsonlIndexLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === 'line'
    && (record.lineKind === 'header' || record.lineKind === 'entry')
    && typeof record.id === 'string'
    && typeof record.entryType === 'string'
    && typeof record.offset === 'number'
    && Number.isSafeInteger(record.offset)
    && record.offset >= 0
    && typeof record.length === 'number'
    && Number.isSafeInteger(record.length)
    && record.length > 0
    && typeof record.sha256 === 'string'
    && (record.userTextSha256 === undefined || typeof record.userTextSha256 === 'string')
    && (record.targetDisplayTextSha256 === undefined
      || typeof record.targetDisplayTextSha256 === 'string');
}

function isFingerprint(value: unknown): value is SessionJsonlSourceFingerprint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.size === 'number'
    && Number.isSafeInteger(record.size)
    && record.size >= 0
    && typeof record.device === 'string'
    && typeof record.inode === 'string'
    && typeof record.modifiedNs === 'string'
    && typeof record.headSha256 === 'string'
    && typeof record.tailSha256 === 'string';
}

function isMigrations(value: unknown): value is SessionJsonlIndexMigrations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const externalContexts = (value as Record<string, unknown>).externalContexts;
  return externalContexts === 0 || externalContexts === 1;
}

function parseIndexFile(sessionFile: string): MutableSessionJsonlIndex | null {
  const indexFile = getSessionJsonlIndexPath(sessionFile);
  if (!existsSync(indexFile)) {
    return null;
  }
  let values: unknown[];
  try {
    values = readFileSync(indexFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  } catch (error) {
    throw new SessionIndexCorruptError('Session index is not valid JSON Lines', sessionFile, { cause: error });
  }
  const format = values[0] as Record<string, unknown> | undefined;
  if (format?.kind !== 'index' || format.version !== INDEX_VERSION) {
    throw new SessionIndexCorruptError('Session index version is missing or unsupported', sessionFile);
  }
  const lines: SessionJsonlIndexLine[] = [];
  let source: SessionJsonlSourceFingerprint | undefined;
  let lineChainSha256 = sha256(Buffer.alloc(0));
  let migrations: SessionJsonlIndexMigrations | undefined;
  let sawCheckpoint = false;
  for (const value of values.slice(1)) {
    if (isIndexLine(value)) {
      if (sawCheckpoint) {
        sawCheckpoint = false;
      }
      lines.push(value);
      lineChainSha256 = extendLineChain(lineChainSha256, [value]);
      continue;
    }
    const record = value as Record<string, unknown> | undefined;
    if (record?.kind === 'checkpoint'
      && isFingerprint(record.source)
      && typeof record.lineChainSha256 === 'string'
      && isMigrations(record.migrations)) {
      if (record.lineChainSha256 !== lineChainSha256) {
        throw new SessionIndexCorruptError('Session index line checksum chain does not match', sessionFile);
      }
      source = record.source;
      migrations = record.migrations;
      sawCheckpoint = true;
      continue;
    }
    throw new SessionIndexCorruptError('Session index contains an invalid record', sessionFile);
  }
  if (!sawCheckpoint || !source || !migrations) {
    throw new SessionIndexCorruptError('Session index is missing its final checkpoint', sessionFile);
  }
  const [header, ...entries] = lines;
  if (!header || header.lineKind !== 'header') {
    throw new SessionIndexCorruptError('Session index is missing its header offset', sessionFile);
  }
  let previous = -1;
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.offset <= previous || line.offset + line.length > source.size) {
      throw new SessionIndexCorruptError('Session index offsets are not monotonic and bounded', sessionFile);
    }
    previous = line.offset;
    if (line.lineKind === 'entry' && !ids.add(line.id)) {
      throw new SessionIndexCorruptError(`Session index contains duplicate entry id ${line.id}`, sessionFile);
    }
  }
  return {
    sessionFile,
    indexFile,
    header,
    entries,
    source,
    lineChainSha256,
    migrations,
  };
}

function assertCurrentSource(index: MutableSessionJsonlIndex): void {
  const current = readStableFingerprint(index.sessionFile);
  if (!fingerprintsEqual(index.source, current)) {
    throw new SessionIndexStaleError('Session index source fingerprint no longer matches JSONL', index.sessionFile);
  }
}

function assertAppendPrefix(
  sessionFile: string,
  previous: SessionJsonlSourceFingerprint,
  current: BigIntStats,
): void {
  if (Number(current.size) < previous.size
    || current.dev.toString() !== previous.device
    || current.ino.toString() !== previous.inode) {
    throw new SessionIndexStaleError('Session file was replaced or truncated before index refresh', sessionFile);
  }
  const headLength = Math.min(previous.size, FINGERPRINT_BYTES);
  const tailOffset = Math.max(0, previous.size - FINGERPRINT_BYTES);
  if (sha256(readSlice(sessionFile, 0, headLength)) !== previous.headSha256
    || sha256(readSlice(sessionFile, tailOffset, previous.size - tailOffset)) !== previous.tailSha256) {
    throw new SessionIndexStaleError('Session bytes changed before the appended range', sessionFile);
  }
}

function cache(index: MutableSessionJsonlIndex): MutableSessionJsonlIndex {
  indexCache.set(index.sessionFile, index);
  return index;
}

export function getSessionJsonlIndexPath(sessionFile: string): string {
  return `${sessionFile}${INDEX_SUFFIX}`;
}

export function captureSessionJsonlSource(sessionFile: string): SessionJsonlSourceFingerprint {
  return readStableFingerprint(sessionFile);
}

export function assertSessionJsonlSourceUnchanged(
  sessionFile: string,
  expected: SessionJsonlSourceFingerprint,
): void {
  if (!fingerprintsEqual(expected, readStableFingerprint(sessionFile))) {
    throw new SessionIndexStaleError('Live session source changed before mutation', sessionFile);
  }
}

export function loadSessionJsonlIndex(sessionFile: string): SessionJsonlIndex | null {
  const index = parseIndexFile(sessionFile);
  if (!index) {
    return null;
  }
  assertCurrentSource(index);
  return cache(index);
}

/** Validate a held index once immediately before a bounded batch read. */
export function validateSessionJsonlIndexSource(index: SessionJsonlIndex): void {
  assertSessionJsonlSourceUnchanged(index.sessionFile, index.source);
}

export function rebuildSessionJsonlIndex(sessionFile: string): SessionJsonlIndex {
  let before = stats(sessionFile);
  let content = readFileSync(sessionFile);
  let after = stats(sessionFile);
  if (statsIdentity(before) !== statsIdentity(after)) {
    throw new SessionIndexStaleError('Session changed while its index was being rebuilt', sessionFile);
  }
  const firstNewline = content.indexOf(0x0a);
  const header = parseJsonObject(
    content.subarray(0, firstNewline >= 0 ? firstNewline : content.length),
    sessionFile,
    0,
  );
  const version = typeof header.version === 'number' ? header.version : 1;
  if (version > CURRENT_SESSION_VERSION) {
    throw new SessionIndexCorruptError(
      `Session version ${version} is newer than supported version ${CURRENT_SESSION_VERSION}`,
      sessionFile,
    );
  }
  if (version < CURRENT_SESSION_VERSION) {
    SessionManager.open(sessionFile);
    before = stats(sessionFile);
    content = readFileSync(sessionFile);
    after = stats(sessionFile);
    if (statsIdentity(before) !== statsIdentity(after)) {
      throw new SessionIndexStaleError('Session changed after Pi format migration', sessionFile);
    }
    const migratedNewline = content.indexOf(0x0a);
    const migratedHeader = parseJsonObject(
      content.subarray(0, migratedNewline >= 0 ? migratedNewline : content.length),
      sessionFile,
      0,
    );
    if (migratedHeader.version !== CURRENT_SESSION_VERSION) {
      throw new SessionIndexCorruptError('Pi did not migrate the session to the current format', sessionFile);
    }
  }
  const lines = scanJsonlLines(content, sessionFile, 0, true);
  const [headerLine, ...entries] = lines;
  if (!headerLine) {
    throw new SessionIndexCorruptError('Cannot index an empty session file', sessionFile);
  }
  const source = fingerprintFromBuffer(before, content);
  const lineChainSha256 = extendLineChain(sha256(Buffer.alloc(0)), lines);
  const migrations: SessionJsonlIndexMigrations = {
    externalContexts: lines.some((line) => line.hasLegacyExternalContext) ? 0 : 1,
  };
  const indexFile = getSessionJsonlIndexPath(sessionFile);
  const temporary = `${indexFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, serializeRecords([
      { kind: 'index', version: INDEX_VERSION },
      ...lines,
      { kind: 'checkpoint', source, lineChainSha256, migrations },
    ]));
    renameSync(temporary, indexFile);
  } finally {
    rmSync(temporary, { force: true });
  }
  return cache({
    sessionFile,
    indexFile,
    header: headerLine,
    entries,
    source,
    lineChainSha256,
    migrations,
  });
}

export function ensureSessionJsonlIndex(sessionFile: string): SessionJsonlIndex {
  const loaded = loadSessionJsonlIndex(sessionFile);
  return loaded ?? rebuildSessionJsonlIndex(sessionFile);
}

/** Read-path recovery: discard a stale/corrupt optimization and rebuild from authoritative JSONL. */
export function readSessionJsonlIndex(sessionFile: string): SessionJsonlIndex {
  try {
    return ensureSessionJsonlIndex(sessionFile);
  } catch (error) {
    if (!(error instanceof SessionIndexError)) throw error;
    invalidateSessionJsonlIndex(sessionFile);
    return rebuildSessionJsonlIndex(sessionFile);
  }
}

export function refreshSessionJsonlIndexAfterAppend(
  sessionFile: string,
  previous: SessionJsonlSourceFingerprint,
  expectedEntryIds: readonly string[],
): SessionJsonlSourceFingerprint {
  const indexFile = getSessionJsonlIndexPath(sessionFile);
  const before = stats(sessionFile);
  assertAppendPrefix(sessionFile, previous, before);
  const nextSize = Number(before.size);
  if (nextSize <= previous.size) {
    throw new SessionIndexStaleError('Session did not grow after an append mutation', sessionFile);
  }
  if (previous.size > 0 && readSlice(sessionFile, previous.size - 1, 1)[0] !== 0x0a) {
    throw new SessionIndexStaleError('Session append did not start at a JSONL line boundary', sessionFile);
  }
  const appended = readSlice(sessionFile, previous.size, nextSize - previous.size);
  const lines = scanJsonlLines(appended, sessionFile, previous.size, false);
  const appendedIds = lines.map((line) => line.id);
  if (JSON.stringify(appendedIds) !== JSON.stringify(expectedEntryIds)) {
    throw new SessionIndexStaleError('Session append contains unexpected entry ids', sessionFile);
  }
  const source = readStableFingerprint(sessionFile);
  if (source.size !== nextSize
    || source.device !== before.dev.toString()
    || source.inode !== before.ino.toString()) {
    throw new SessionIndexStaleError('Session changed while appended offsets were being indexed', sessionFile);
  }
  if (!existsSync(indexFile)) {
    return source;
  }
  const index = indexCache.get(sessionFile) ?? parseIndexFile(sessionFile);
  if (!index) {
    throw new SessionIndexCorruptError('Session index disappeared during append refresh', sessionFile);
  }
  if (!fingerprintsEqual(index.source, previous)) {
    throw new SessionIndexStaleError('Session index was stale before append refresh', sessionFile);
  }
  const lineChainSha256 = extendLineChain(index.lineChainSha256, lines);
  const migrations: SessionJsonlIndexMigrations = {
    externalContexts: index.migrations.externalContexts === 0
      || lines.some((line) => line.hasLegacyExternalContext)
      ? 0
      : 1,
  };
  appendFileSync(indexFile, serializeRecords([
    ...lines,
    { kind: 'checkpoint', source, lineChainSha256, migrations },
  ]));
  index.entries.push(...lines);
  index.source = source;
  index.lineChainSha256 = lineChainSha256;
  index.migrations = migrations;
  cache(index);
  return source;
}

export function invalidateSessionJsonlIndex(sessionFile: string): void {
  indexCache.delete(sessionFile);
  const indexFile = getSessionJsonlIndexPath(sessionFile);
  if (existsSync(indexFile)) {
    unlinkSync(indexFile);
  }
}

export function readSessionJsonlIndexedLine(
  index: SessionJsonlIndex,
  line: SessionJsonlIndexLine,
): Record<string, unknown> {
  const raw = readSlice(index.sessionFile, line.offset, line.length);
  if (sha256(raw) !== line.sha256) {
    throw new SessionIndexStaleError(`Session bytes do not match indexed entry ${line.id}`, index.sessionFile);
  }
  const parsed = parseJsonObject(raw, index.sessionFile, line.offset);
  if (parsed.id !== line.id || parsed.type !== line.entryType) {
    throw new SessionIndexStaleError(`Session entry identity does not match indexed entry ${line.id}`, index.sessionFile);
  }
  return parsed;
}
