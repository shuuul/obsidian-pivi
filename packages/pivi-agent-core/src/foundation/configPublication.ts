/**
 * Failure-safe config publication helpers: corrupt preservation, atomic replace,
 * and per-path serialized saves.
 */

import { PluginLogger } from '../foundation/pluginLogger';
import type { FileStore } from '../ports';

const logger = new PluginLogger('ConfigPublication');

const saveChains = new Map<string, Promise<unknown>>();

export interface ParseDiagnostic {
  code: 'invalid-json' | 'invalid-shape' | 'unsupported-version';
  message: string;
  path: string;
}

export type ParseResult<T> =
  | {
    ok: true;
    value: T;
    diagnostics: ParseDiagnostic[];
  }
  | {
    ok: false;
    diagnostics: ParseDiagnostic[];
    rawContent: string;
  };

export async function preserveCorruptArtifact(
  adapter: FileStore,
  sourcePath: string,
  content: string,
): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const corruptPath = `${sourcePath}.corrupt-${stamp}`;
  await adapter.write(corruptPath, content);
  logger.warn(`Preserved corrupt config at ${corruptPath}`);
  return corruptPath;
}

/** Write via temp + rename when the store supports rename; otherwise direct write. */
export async function writeFileAtomically(
  adapter: FileStore,
  path: string,
  content: string,
): Promise<void> {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (parent && typeof adapter.ensureFolder === 'function') {
    await adapter.ensureFolder(parent);
  }

  const canRename = typeof adapter.rename === 'function';
  if (!canRename) {
    await adapter.write(path, content);
    return;
  }

  const tempPath = `${path}.tmp-${Date.now().toString(36)}`;
  try {
    await adapter.write(tempPath, content);
    if (await adapter.exists(path)) {
      const backupPath = `${path}.bak-${Date.now().toString(36)}`;
      try {
        await adapter.rename(path, backupPath);
        try {
          await adapter.rename(tempPath, path);
          if (typeof adapter.delete === 'function') {
            await adapter.delete(backupPath).catch(() => undefined);
          }
          return;
        } catch (error) {
          await adapter.rename(backupPath, path).catch(() => undefined);
          throw error;
        }
      } catch {
        // Fall through to direct overwrite when rename replace fails.
      }
    } else {
      try {
        await adapter.rename(tempPath, path);
        return;
      } catch {
        // Fall through.
      }
    }
    await adapter.write(path, content);
    if (typeof adapter.delete === 'function') {
      await adapter.delete(tempPath).catch(() => undefined);
    }
  } catch (error) {
    if (typeof adapter.delete === 'function') {
      await adapter.delete(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Serialize concurrent save operations for the same logical path so mixed
 * secret/config generations cannot interleave.
 */
export async function runSerializedSave<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = saveChains.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(async () => {
    try {
      return await operation();
    } finally {
      release();
    }
  });
  saveChains.set(path, next.then(() => gate).catch(() => gate));
  return next;
}

export function parseJsonObjectWithDiagnostics(
  path: string,
  content: string,
): ParseResult<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        rawContent: content,
        diagnostics: [{
          code: 'invalid-shape',
          message: `Expected a JSON object in ${path}.`,
          path,
        }],
      };
    }
    return {
      ok: true,
      value: parsed as Record<string, unknown>,
      diagnostics: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      rawContent: content,
      diagnostics: [{
        code: 'invalid-json',
        message: `Invalid JSON in ${path}: ${message}`,
        path,
      }],
    };
  }
}
