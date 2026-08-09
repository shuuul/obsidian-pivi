/** Canonical workspace-command variable for the current editor selection. */
export const SELECTED_TEXT_TEMPLATE_TOKEN = '{{selected_text}}';

export function normalizeAliases(aliases: readonly string[] | undefined): string[] {
  if (!aliases) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function findMatchedAlias(aliases: readonly string[], searchLower: string): string | undefined {
  if (!searchLower) return undefined;
  return aliases.find(alias => alias.toLowerCase().includes(searchLower));
}

export function getPreferredAlias(
  normalizedAliases: readonly string[] | undefined,
  preferredAlias?: string,
): string | undefined {
  return preferredAlias?.trim() || normalizedAliases?.[0];
}

export function canUseWikilinkAlias(path: string, alias: string | undefined): alias is string {
  if (!alias?.trim()) return false;
  return !path.includes('|') && !path.includes('\n') && !alias.includes(']') && !alias.includes('\n');
}

export function formatVaultFileMentionToken(path: string, alias: string | undefined): string {
  return canUseWikilinkAlias(path, alias) ? `@[[${path}|${alias.trim()}]]` : `@${path}`;
}
