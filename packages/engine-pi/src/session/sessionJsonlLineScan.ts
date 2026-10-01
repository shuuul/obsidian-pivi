import {
  PIVI_MESSAGE_UI,
  PIVI_UI_CONTEXT,
  SessionIndexCorruptError,
} from '@pivi/agent/session/types';
import { createHash } from 'crypto';

import {
  hashDurableUserContent,
  hashVisibleUserText,
} from './sessionMessageProjection';

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

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseJsonObject(raw: Buffer, sessionFile: string, offset: number): Record<string, unknown> {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

type IndexableLine = Record<string, unknown> & { id: string; type: string };

function assertIndexableLine(
  parsed: Record<string, unknown>,
  isHeader: boolean,
  sessionFile: string,
  offset: number,
): asserts parsed is IndexableLine {
  if (isHeader) {
    if (parsed.type !== 'session' || typeof parsed.id !== 'string') {
      throw new SessionIndexCorruptError('Session JSONL does not start with a valid header', sessionFile);
    }
  } else if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
    throw new SessionIndexCorruptError(
      `Session entry at byte ${offset} is missing type or id`,
      sessionFile,
    );
  }
}

function projectIndexLine(
  parsed: IndexableLine,
  isHeader: boolean,
  raw: Buffer,
  offset: number,
): SessionJsonlIndexLine {
  const message = asRecord(parsed.message);
  const data = asRecord(parsed.data);
  const turnRequest = asRecord(data?.turnRequest);
  const hasLegacyExternalContext = (
    parsed.customType === PIVI_UI_CONTEXT
    && Object.hasOwn(data ?? {}, 'externalContextPaths')
  ) || (
    parsed.customType === PIVI_MESSAGE_UI
    && Object.hasOwn(turnRequest ?? {}, 'externalContextPaths')
  );
  return {
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
    offset,
    length: raw.length,
    sha256: sha256(raw),
  };
}

export function scanJsonlLines(
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
    const offset = baseOffset + lineStart;
    const parsed = parseJsonObject(raw, sessionFile, offset);
    const isHeader = includeHeader && lines.length === 0;
    assertIndexableLine(parsed, isHeader, sessionFile, offset);
    lines.push(projectIndexLine(parsed, isHeader, raw, offset));
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }
  return lines;
}
