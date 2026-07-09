import type { MentionItem } from './types';

export const DEFAULT_MENTION_DROPDOWN_MAX_WIDTH = 320;
export const EXPANDED_MENTION_DROPDOWN_MAX_WIDTH = 480;
export const MIN_MENTION_DROPDOWN_WIDTH = 180;
export const ESTIMATED_MENTION_TEXT_CHAR_WIDTH = 7;
export const MENTION_DROPDOWN_HORIZONTAL_CHROME = 52;

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

export function getMentionItemWidthText(item: MentionItem): string {
  switch (item.type) {
    case 'file': {
      const alias = getPreferredAlias(item.aliases, item.matchedAlias);
      return alias ? `${alias} ${item.path}` : item.path;
    }
    case 'folder':
      return item.path;
    case 'context-file':
      return item.name;
    case 'context-folder':
      return item.name;
    case 'agent':
      return `${item.id} ${item.description ?? ''}`;
    case 'agent-folder':
      return item.name;
  }
}
