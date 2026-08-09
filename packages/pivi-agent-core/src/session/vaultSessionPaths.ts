export const PIVI_SESSION_ROOT = '.pivi/sessions';
export const SESSION_JSONL_EXTENSION = '.jsonl';

export class InvalidSessionPathError extends Error {
  constructor(readonly path: string) {
    super(`Invalid Vault-relative session path: ${path}`);
    this.name = 'InvalidSessionPathError';
  }
}

/** Validate and return a canonical Vault-relative session JSONL path. */
export function requireVaultSessionPath(path: string): string {
  if (
    path.length === 0 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new InvalidSessionPathError(path);
  }

  const segments = path.split('/');
  if (
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    segments[0] !== '.pivi' ||
    segments[1] !== 'sessions' ||
    segments.length < 3 ||
    !path.endsWith(SESSION_JSONL_EXTENSION)
  ) {
    throw new InvalidSessionPathError(path);
  }
  return path;
}

/** Create a root-level Mobile-safe filename without filesystem or random APIs. */
export function createMobileSessionPath(sessionId: string, date = new Date()): string {
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !Number.isFinite(date.getTime())) {
    throw new InvalidSessionPathError(`${PIVI_SESSION_ROOT}/${sessionId}`);
  }
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return requireVaultSessionPath(`${PIVI_SESSION_ROOT}/${timestamp}_${sessionId}.jsonl`);
}
