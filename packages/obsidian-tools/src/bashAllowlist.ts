import { matchEncodedBashAllowlist } from '@pivi/agent/tools';

export const DEFAULT_SAFE_BASH_ALLOWLIST = ['which', 'type', 'pwd'] as const;

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

export function buildEffectiveBashAllowlist(userAllowlist?: readonly string[]): readonly string[] {
  return normalizeAllowlist([...DEFAULT_SAFE_BASH_ALLOWLIST, ...(userAllowlist ?? [])]);
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
