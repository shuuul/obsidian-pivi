import * as fs from 'fs';
import * as path from 'path';

/** Encode vault cwd for pi-compatible session directory names. */
export function encodeSessionCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** Vault-local pi-compatible session root: `<vault>/.pivi/sessions/--<encoded>--/`. */
export function getPiviSessionDir(vaultPath: string): string {
  const sessionDir = path.join(vaultPath, '.pivi', 'sessions', encodeSessionCwd(vaultPath));
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
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
