import * as path from 'node:path';

import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';

import type { ObsidianToolDeps } from './deps';

/**
 * External tools prefer absolute paths. Vault-relative paths are resolved
 * against the current vault so skill/unindexed files under `.pivi/` still work
 * when the model copies a vault-relative name.
 */
export function resolveExternalToolPath(deps: ObsidianToolDeps, requested: string): string {
  const normalized = normalizePathForFilesystem(requested.trim());
  if (!normalized) {
    throw new Error('Invalid external path: empty path');
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  if (!deps.vaultPath) {
    throw new Error(`External path must be absolute: ${normalized}`);
  }
  return path.resolve(deps.vaultPath, normalized);
}
