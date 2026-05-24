import * as fs from 'fs';
import * as path from 'path';

/** Encode vault cwd for pi-compatible session directory names. */
export function encodeSessionCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** Vault-local pi-compatible session root: `<vault>/.obsius/sessions/--<encoded>--/`. */
export function getObsiusSessionDir(vaultPath: string): string {
  const sessionDir = path.join(vaultPath, '.obsius', 'sessions', encodeSessionCwd(vaultPath));
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

export const OBSIUS_SKILLS_DIR = '.obsius/skills';
export const OBSIUS_SYSTEM_MD = '.obsius/SYSTEM.md';
