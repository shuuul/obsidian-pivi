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
