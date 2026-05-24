import { accessSync, constants } from 'fs';
import { Platform } from 'obsidian';
import { homedir } from 'os';
import { join } from 'path';

/** Resolve the Obsidian CLI binary; GUI apps often lack homebrew on PATH. */
export function resolveObsidianCliBinary(configuredPath?: string | null): string {
  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const fromEnv = process.env.OBSIDIAN_CLI_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const candidates: string[] = [];
  if (Platform.isMacOS) {
    candidates.push(
      '/usr/local/bin/obsidian',
      '/opt/homebrew/bin/obsidian',
      '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli',
    );
  } else if (Platform.isLinux) {
    candidates.push('/usr/local/bin/obsidian', join(homedir(), '.local/bin/obsidian'));
  }

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return 'obsidian';
}

/** Append common install dirs so spawn works from Obsidian's trimmed GUI PATH. */
export function augmentPathForSpawn(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sep = Platform.isWin ? ';' : ':';
  const current = env.PATH ?? env.Path ?? '';
  const extra = Platform.isWin
    ? []
    : ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local/bin')];
  const parts = new Set([...extra, ...current.split(sep).filter(Boolean)]);
  const merged = [...parts].join(sep);
  return { ...env, PATH: merged, Path: merged };
}
