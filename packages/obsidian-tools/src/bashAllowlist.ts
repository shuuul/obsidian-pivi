import { isWindowsCmdShell, matchEncodedBashAllowlist } from '@pivi/agent/tools';

export const DEFAULT_SAFE_BASH_ALLOWLIST = ['which', 'type', 'pwd'] as const;
export const DEFAULT_WINDOWS_SAFE_BASH_ALLOWLIST = ['where', 'cd'] as const;

function normalizeAllowlist(value: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value ?? []) {
    const command = entry.trim();
    if (!command || seen.has(command)) {
      continue;
    }
    seen.add(command);
    normalized.push(command);
  }
  return normalized;
}

export function buildEffectiveBashAllowlist(
  userAllowlist?: readonly string[],
  shellPath = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
): readonly string[] {
  const defaults = isWindowsCmdShell(shellPath)
    ? DEFAULT_WINDOWS_SAFE_BASH_ALLOWLIST
    : DEFAULT_SAFE_BASH_ALLOWLIST;
  return normalizeAllowlist([...defaults, ...(userAllowlist ?? [])]);
}

/**
 * Match one shell-safe command against exact argv or argv-prefix entries.
 * Shell control, substitution, redirects, and additional commands are rejected
 * before matching because execution uses `$SHELL -lc`.
 */
export function matchBashCommandAllowlist(
  command: string,
  allowlist: readonly string[],
  shellPath = '/bin/sh',
): boolean {
  return matchEncodedBashAllowlist(command, shellPath, allowlist);
}
