import * as fs from 'node:fs';
import * as path from 'node:path';

import { isDisabledToolName, TOOL_OBSIDIAN_LIST, TOOL_OBSIDIAN_READ } from '@pivi/agent/tools';
import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';

import type { ObsidianToolDeps } from './deps';

export type UnmanagedVaultKind = 'file' | 'directory';

function existingAbsolutePath(
  deps: ObsidianToolDeps,
  requested: string,
  kind: UnmanagedVaultKind,
): string | null {
  const normalized = normalizePathForFilesystem(requested.trim());
  if (!normalized) {
    return null;
  }

  const candidates: string[] = [];
  if (path.isAbsolute(normalized)) {
    candidates.push(normalized);
  }
  if (deps.vaultPath) {
    candidates.push(path.resolve(deps.vaultPath, normalized));
  }

  for (const candidate of candidates) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (kind === 'file' && stat.isFile()) {
      return candidate;
    }
    if (kind === 'directory' && stat.isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function isVaultIndexMiss(message: string, kind: UnmanagedVaultKind): boolean {
  if (kind === 'file') {
    return message.includes('Note not found');
  }
  return message.includes('Vault path not found');
}

export function resolveUnmanagedAbsolutePath(
  deps: ObsidianToolDeps,
  params: { file?: string; path?: string },
  error: unknown,
  kind: UnmanagedVaultKind,
): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const requested = params.path?.trim() || params.file?.trim();
  const liveName = kind === 'file' ? TOOL_OBSIDIAN_READ : TOOL_OBSIDIAN_LIST;
  if (
    !requested
    || !isVaultIndexMiss(message, kind)
    || isDisabledToolName(deps.settings?.disabledTools, liveName)
  ) {
    return null;
  }
  return existingAbsolutePath(deps, requested, kind);
}

/**
 * Vault tools resolve through Obsidian's index. Hidden or excluded trees such as
 * `.pivi/skills` exist on disk but are not TFile/TFolder entries; callers should
 * route those hits through ExternalFileApi instead of asking the model to retry.
 */
export function rethrowIfUnmanagedVaultPath(
  deps: ObsidianToolDeps,
  params: { file?: string; path?: string },
  error: unknown,
  kind: UnmanagedVaultKind,
): never {
  throw error;
}
