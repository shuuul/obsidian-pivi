import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { posix, win32 } from 'path';

export function getOfficialObsidianConfigPath(): string | null {
  if (typeof process === 'undefined') {
    return null;
  }

  if (process.platform === 'darwin') {
    return posix.join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    return appData ? win32.join(appData, 'obsidian', 'obsidian.json') : null;
  }

  return posix.join(homedir(), '.config', 'obsidian', 'obsidian.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isOfficialObsidianCliEnabled(): boolean {
  const configPath = getOfficialObsidianConfigPath();
  if (!configPath || !existsSync(configPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    return isRecord(parsed) && parsed.cli === true;
  } catch {
    return false;
  }
}
