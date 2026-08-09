/**
 * Device-local location for rebuildable session JSONL indexes.
 * Indexes must not live beside synced `.pivi/sessions/*.jsonl` files.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';

const INDEX_SUFFIX = '.pivi-index';

let configuredIndexRoot: string | null = null;

/** Absolute directory for device-local indexes, or null to use colocated legacy paths (tests only). */
export function configureSessionJsonlIndexRoot(root: string | null): void {
  configuredIndexRoot = root;
  if (root) {
    mkdirSync(root, { recursive: true });
  }
}

export function getConfiguredSessionJsonlIndexRoot(): string | null {
  return configuredIndexRoot;
}

export function encodeSessionJsonlIndexKey(absoluteSessionFile: string): string {
  return createHash('sha256').update(absoluteSessionFile, 'utf8').digest('hex');
}

export function getLegacySessionJsonlIndexPath(sessionFile: string): string {
  return `${sessionFile}${INDEX_SUFFIX}`;
}

/**
 * Resolve the device-local index path when configured; otherwise the legacy
 * colocated sidecar path (kept for unit tests that do not configure a root).
 */
export function getSessionJsonlIndexPath(sessionFile: string): string {
  if (!configuredIndexRoot) {
    return getLegacySessionJsonlIndexPath(sessionFile);
  }
  return join(configuredIndexRoot, `${encodeSessionJsonlIndexKey(sessionFile)}${INDEX_SUFFIX}`);
}

/** Move a legacy colocated sidecar into the device-local root when present. */
export function migrateLegacySessionJsonlIndex(sessionFile: string): void {
  if (!configuredIndexRoot) {
    return;
  }
  const legacy = getLegacySessionJsonlIndexPath(sessionFile);
  const target = getSessionJsonlIndexPath(sessionFile);
  if (!existsSync(legacy)) {
    return;
  }
  if (existsSync(target)) {
    unlinkSync(legacy);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(legacy, target);
  } catch {
    // Best-effort: leave rebuild to read/rebuild path if rename fails.
  }
}
