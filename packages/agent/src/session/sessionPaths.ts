import * as path from 'path';

export const PIVI_SESSIONS_PREFIX = '.pivi/sessions/';
export const PIVI_SESSION_TRASH_PREFIX = '.pivi/trash/sessions/';

/** Encode vault cwd for pi-compatible session directory names. */
export function encodeSessionCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** Vault-local root shared by every device's pi-compatible session directory. */
export function getPiviSessionRoot(vaultPath: string): string {
  return path.join(vaultPath, '.pivi', 'sessions');
}

/** Vault-local trash root that mirrors `.pivi/sessions/` for recoverable deletes. */
export function getPiviSessionTrashRoot(vaultPath: string): string {
  return path.join(vaultPath, '.pivi', 'trash', 'sessions');
}

export function isVaultSessionFile(sessionFile: string): boolean {
  return sessionFile.startsWith(PIVI_SESSIONS_PREFIX)
    && sessionFile.endsWith('.jsonl')
    && !sessionFile.includes('\\')
    && !sessionFile.includes('\0')
    && !sessionFile.split('/').includes('..');
}

/** Map a live session path onto the mirrored trash path. */
export function toTrashedSessionFile(sessionFile: string): string {
  if (!isVaultSessionFile(sessionFile)) {
    throw new Error(`Invalid session file: ${sessionFile}`);
  }
  return `${PIVI_SESSION_TRASH_PREFIX}${sessionFile.slice(PIVI_SESSIONS_PREFIX.length)}`;
}

/** Map a trash session path back to its live `.pivi/sessions/` identity. */
export function toLiveSessionFile(trashedFile: string): string {
  if (
    !trashedFile.startsWith(PIVI_SESSION_TRASH_PREFIX)
    || !trashedFile.endsWith('.jsonl')
    || trashedFile.includes('\\')
    || trashedFile.includes('\0')
    || trashedFile.split('/').includes('..')
  ) {
    throw new Error(`Invalid trashed session file: ${trashedFile}`);
  }
  return `${PIVI_SESSIONS_PREFIX}${trashedFile.slice(PIVI_SESSION_TRASH_PREFIX.length)}`;
}

/** Vault-local pi-compatible session root: `<vault>/.pivi/sessions/--<encoded>--/`. */
export function getPiviSessionDir(vaultPath: string): string {
  return path.join(getPiviSessionRoot(vaultPath), encodeSessionCwd(vaultPath));
}

/** Convert an absolute session path to vault-relative (forward slashes). */
export function toVaultRelativePath(vaultPath: string, absolutePath: string): string {
  const vault = path.resolve(vaultPath);
  const file = path.resolve(absolutePath);
  const prefix = vault + path.sep;
  if (file.startsWith(prefix)) {
    return file.slice(prefix.length).split(path.sep).join('/');
  }
  return absolutePath.split(path.sep).join('/');
}

/** Resolve vault-relative path to absolute for SessionManager. */
export function toAbsoluteSessionPath(vaultPath: string, sessionFile: string): string {
  if (path.isAbsolute(sessionFile)) {
    return sessionFile;
  }
  return path.join(vaultPath, sessionFile.split('/').join(path.sep));
}
