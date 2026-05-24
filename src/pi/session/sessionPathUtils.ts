import * as path from 'path';

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
