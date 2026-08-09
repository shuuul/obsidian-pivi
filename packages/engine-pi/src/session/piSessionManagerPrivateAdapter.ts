/**
 * Explicit adapter for the narrow Pi SessionManager private surface Pivi needs.
 *
 * Upstream lacks public APIs for eager header flush and truncate/rewind. Keep
 * every private-member access here and fail loudly when a Pi upgrade removes a
 * required capability, rather than mutating session state through a broken cast.
 */

import type { FileEntry } from '@earendil-works/pi-coding-agent';

import { VERSION as PIVI_PI_VERSION } from '../shims/piCodingAgentConfig';

export const PI_SESSION_MANAGER_PRIVATE_CAPABILITIES = [
  '_rewriteFile',
  'flushed',
  'fileEntries',
  '_buildIndex',
] as const;

export type PiSessionManagerPrivateCapability =
  (typeof PI_SESSION_MANAGER_PRIVATE_CAPABILITIES)[number];

export interface PiSessionManagerPrivateSurface {
  fileEntries: FileEntry[];
  flushed: boolean;
  _rewriteFile(): void;
  _buildIndex(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function missingPrivateCapabilities(manager: unknown): PiSessionManagerPrivateCapability[] {
  if (!isRecord(manager)) {
    return [...PI_SESSION_MANAGER_PRIVATE_CAPABILITIES];
  }
  const missing: PiSessionManagerPrivateCapability[] = [];
  if (typeof manager._rewriteFile !== 'function') {
    missing.push('_rewriteFile');
  }
  if (!('flushed' in manager)) {
    missing.push('flushed');
  }
  if (!Array.isArray(manager.fileEntries)) {
    missing.push('fileEntries');
  }
  if (typeof manager._buildIndex !== 'function') {
    missing.push('_buildIndex');
  }
  return missing;
}

/**
 * Asserts that a SessionManager exposes the private members Pivi depends on.
 *
 * @throws Error with the missing members, expected Pi version, and upgrade guidance.
 */
export function assertPiSessionManagerPrivateCapabilities(
  manager: unknown,
  context: string,
): asserts manager is PiSessionManagerPrivateSurface {
  const missing = missingPrivateCapabilities(manager);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Pi SessionManager is missing private capabilities required for ${context}: ${missing.join(', ')}. `
    + `Pivi expects @earendil-works/pi-coding-agent@${PIVI_PI_VERSION} (exact pin) with these internals. `
    + 'Do not mutate the session. Upgrade the three Pi packages as one exact unit only after '
    + '`npm run test:pi-compat` passes.',
  );
}

/** Eagerly rewrite a persisted SessionManager file and mark Pi's lazy writer flushed. */
export function rewritePersistedSessionManager(manager: unknown): void {
  assertPiSessionManagerPrivateCapabilities(manager, 'eager session rewrite');
  manager._rewriteFile();
  manager.flushed = true;
}

/**
 * Truncate a SessionManager's in-memory fileEntries to the header-only prefix or
 * the prefix ending at `entryId`, then rebuild Pi's index.
 *
 * @returns false when the target entry is absent; throws before mutation when
 *   private capabilities are missing.
 */
export function truncatePersistedSessionManager(
  manager: unknown,
  entryId: string | null,
): boolean {
  assertPiSessionManagerPrivateCapabilities(manager, 'session truncate/rewind');
  const fileEntries = manager.fileEntries;
  const header = fileEntries.find((entry) => entry.type === 'session');
  if (!header) {
    return false;
  }

  if (entryId === null) {
    manager.fileEntries = [header];
  } else {
    const index = fileEntries.findIndex((entry) => (
      entry.type !== 'session' && entry.id === entryId
    ));
    if (index < 0) {
      return false;
    }
    manager.fileEntries = fileEntries.slice(0, index + 1);
  }

  manager._buildIndex();
  return true;
}
