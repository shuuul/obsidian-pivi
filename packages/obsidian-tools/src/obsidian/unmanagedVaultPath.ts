import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_READ_EXTERNAL,
} from '@pivi/agent/tools';
import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';

import type { ObsidianToolDeps } from './deps';

export type UnmanagedVaultKind = 'file' | 'directory';

function isToolDisabled(deps: ObsidianToolDeps, toolName: string): boolean {
  return (deps.settings?.disabledTools ?? []).includes(toolName);
}

function isExternalToolAvailable(deps: ObsidianToolDeps, toolName: string): boolean {
  if (isToolDisabled(deps, toolName)) {
    return false;
  }
  return Boolean(deps.vaultPath) || Boolean(deps.settings?.allowExternalRead);
}

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

/**
 * Vault tools resolve through Obsidian's index. Hidden or excluded trees such as
 * `.pivi/skills` exist on disk but are not TFile/TFolder entries, so a miss that
 * still exists on disk should send the model to the matching external tool.
 */
export function rethrowIfUnmanagedVaultPath(
  deps: ObsidianToolDeps,
  params: { file?: string; path?: string },
  error: unknown,
  kind: UnmanagedVaultKind,
): never {
  const message = error instanceof Error ? error.message : String(error);
  const requested = params.path?.trim() || params.file?.trim();
  const externalName = kind === 'file' ? TOOL_OBSIDIAN_READ_EXTERNAL : TOOL_OBSIDIAN_LIST_EXTERNAL;
  if (
    !requested
    || !isVaultIndexMiss(message, kind)
    || !isExternalToolAvailable(deps, externalName)
  ) {
    throw error;
  }

  const absolute = existingAbsolutePath(deps, requested, kind);
  if (!absolute) {
    throw error;
  }

  const noun = kind === 'file' ? 'file' : 'folder';
  throw new Error(
    `${message} This ${noun} exists on disk but is not an Obsidian-indexed vault ${noun}. Retry with \`${externalName}\` using the absolute path \`${absolute}\`.`,
  );
}
