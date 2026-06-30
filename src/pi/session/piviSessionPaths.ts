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

export const PIVI_SKILLS_DIR = '.pivi/skills';
export const PIVI_SYSTEM_MD = '.pivi/SYSTEM.md';
