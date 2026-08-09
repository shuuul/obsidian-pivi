import { sanitizeMessageUiForJsonl } from '../../../session/messageUi';
import { PIVI_MESSAGE_UI, PIVI_UI_CONTEXT } from '../../../session/types';

export interface ExternalContextJsonlMigration {
  content: string;
  changed: boolean;
  sessionPaths?: string[];
  turnPaths: Map<string, string[]>;
}

export class ExternalContextJsonlMigrationError extends Error {}

function externalPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string')
    : [];
}

/** Remove device-local absolute paths while preserving untouched JSONL lines and newline shape. */
export function stripExternalContextsFromSessionJsonl(
  content: string,
  sessionFile: string,
): ExternalContextJsonlMigration {
  const hasFinalNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasFinalNewline) lines.pop();
  let changed = false;
  let sessionPaths: string[] | undefined;
  const turnPaths = new Map<string, string[]>();
  const migratedLines = lines.map((line, index) => {
    if (!line.trim()) return line;
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return line;
      parsed = value as Record<string, unknown>;
    } catch (error) {
      throw new ExternalContextJsonlMigrationError(
        `Failed to migrate external contexts in ${sessionFile} at line ${index + 1}`,
        { cause: error },
      );
    }
    if (parsed.type !== 'custom' || !parsed.data || typeof parsed.data !== 'object'
      || Array.isArray(parsed.data)) return line;
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
