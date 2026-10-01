/** Stateless helpers for PiSessionStore: JSONL discovery, message-UI patch comparison, and the external-context JSONL migration. */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeMessageUiForJsonl } from '@pivi/agent/session/messageUi';
import { getPiviSessionRoot } from '@pivi/agent/session/sessionPaths';
import type {
  DeviceLocalExternalContextStore,
  MessageUiPatch,
} from '@pivi/agent/session/types';
import {
  PIVI_MESSAGE_UI,
  PIVI_UI_CONTEXT,
  type PiviSessionMetaData,
} from '@pivi/agent/session/types';

export function stableJson(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`;
}

export function patchAlreadyPersisted(
  current: MessageUiPatch | undefined,
  patch: MessageUiPatch,
): boolean {
  const patchKeys = Object.keys(patch)
    .filter((key) => key !== 'targetEntryId') as Array<keyof MessageUiPatch>;
  if (patchKeys.length === 0) {
    return true;
  }
  if (!current) {
    return false;
  }
  return patchKeys.every((key) => stableJson(current[key]) === stableJson(patch[key]));
}

export function mergeMessageUiPatch(
  current: MessageUiPatch | undefined,
  patch: MessageUiPatch,
): MessageUiPatch {
  return {
    ...current,
    ...patch,
  };
}

export function arraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (const [index, value] of a.entries()) {
    const other = b[index];
    if (other === undefined || value !== other) {
      return false;
    }
  }
  return true;
}

export function listJsonlFilesUnder(root: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(join(root, entry.name));
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(root, entry.name);
    try {
      files.push(...readdirSync(directory)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => join(directory, file)));
    } catch {
      // An iCloud File Provider directory can disappear while being enumerated.
    }
  }
  return files;
}

export function listVaultSessionJsonlFiles(vaultPath: string): string[] {
  return listJsonlFilesUnder(getPiviSessionRoot(vaultPath));
}

export function parentVaultRelativePath(file: string): string {
  const index = file.lastIndexOf('/');
  return index <= 0 ? '' : file.slice(0, index);
}

export interface ExternalContextJsonlMigration {
  content: string;
  changed: boolean;
  sessionPaths?: string[];
  turnPaths: Map<string, string[]>;
}

export function externalPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string')
    : [];
}

export class ExternalContextJsonlMigrationError extends Error {}

/** Pure, line-preserving migration used by startup and lazy session opens. */
export function stripExternalContextsFromSessionJsonl(
  content: string,
  sessionFile: string,
): ExternalContextJsonlMigration {
  const hasFinalNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasFinalNewline) {
    lines.pop();
  }
  let changed = false;
  let sessionPaths: string[] | undefined;
  const turnPaths = new Map<string, string[]>();
  const migratedLines = lines.map((line, index) => {
    if (!line.trim()) {
      return line;
    }
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return line;
      }
      parsed = value as Record<string, unknown>;
    } catch (error) {
      throw new ExternalContextJsonlMigrationError(
        `Failed to migrate external contexts in ${sessionFile} at line ${index + 1}`,
        { cause: error },
      );
    }
    if (parsed.type !== 'custom' || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return line;
    }
    const data = parsed.data as Record<string, unknown>;
    if (parsed.customType === PIVI_UI_CONTEXT && Object.hasOwn(data, 'externalContextPaths')) {
      sessionPaths = externalPaths(data.externalContextPaths);
      const nextData = { ...data };
      Reflect.deleteProperty(nextData, 'externalContextPaths');
      changed = true;
      return JSON.stringify({ ...parsed, data: nextData });
    }
    if (parsed.customType === PIVI_MESSAGE_UI && typeof data.targetEntryId === 'string') {
      const result = sanitizeMessageUiForJsonl(data);
      if (result.externalContextPaths) {
        turnPaths.set(data.targetEntryId, result.externalContextPaths);
        changed = true;
        return JSON.stringify({ ...parsed, data: result.sanitized });
      }
    }
    return line;
  });
  return {
    content: migratedLines.join('\n') + (hasFinalNewline ? '\n' : ''),
    changed,
    sessionPaths,
    turnPaths,
  };
}

export class MemoryExternalContextStore implements DeviceLocalExternalContextStore {
  private readonly sessions = new Map<string, { selected: string[]; turns: Map<string, string[]> }>();
  private session(file: string) {
    let value = this.sessions.get(file);
    if (!value) {
      value = { selected: [], turns: new Map() };
      this.sessions.set(file, value);
    }
    return value;
  }
  getSessionPaths(file: string): string[] { return [...this.session(file).selected]; }
  setSessionPaths(file: string, paths: readonly string[]): void { this.session(file).selected = [...paths]; }
  getTurnPaths(file: string, entryId: string): string[] { return [...(this.session(file).turns.get(entryId) ?? [])]; }
  setTurnPaths(file: string, entryId: string, paths: readonly string[]): void { this.session(file).turns.set(entryId, [...paths]); }
  copySession(source: string, target: string): void {
    const current = this.session(source);
    this.sessions.set(target, {
      selected: [...current.selected],
      turns: new Map([...current.turns].map(([id, paths]) => [id, [...paths]])),
    });
  }
  deleteSession(file: string): void { this.sessions.delete(file); }
}

export function sessionMetaEqual(
  a: PiviSessionMetaData | null | undefined,
  b: PiviSessionMetaData,
): boolean {
  return !!a
    && a.title === b.title
    && a.titleSource === b.titleSource
    && a.createdAt === b.createdAt
    && a.lastResponseAt === b.lastResponseAt;
}
