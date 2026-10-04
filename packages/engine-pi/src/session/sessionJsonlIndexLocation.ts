/**
 * Device-local location for rebuildable session JSONL indexes.
 * Indexes must not live beside synced `.pivi/sessions/*.jsonl` files.
 */

import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const INDEX_SUFFIX = '.pivi-index';

let configuredIndexRoot: string | null = null;

/** Absolute directory for device-local indexes, or null to colocate the index beside the session file (tests only). */
export function configureSessionJsonlIndexRoot(root: string | null): void {
  configuredIndexRoot = root;
  if (root) {
    mkdirSync(root, { recursive: true });
  }
}

function encodeSessionJsonlIndexKey(absoluteSessionFile: string): string {
  return createHash('sha256').update(absoluteSessionFile, 'utf8').digest('hex');
}

/**
 * Resolve the device-local index path when configured; otherwise a colocated
 * path for unit tests that do not configure a root.
 */
export function getSessionJsonlIndexPath(sessionFile: string): string {
  if (!configuredIndexRoot) {
    return `${sessionFile}${INDEX_SUFFIX}`;
  }
  return join(configuredIndexRoot, `${encodeSessionJsonlIndexKey(sessionFile)}${INDEX_SUFFIX}`);
}
