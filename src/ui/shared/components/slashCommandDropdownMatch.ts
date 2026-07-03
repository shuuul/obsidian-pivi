import type { DropdownItem } from './slashCommandDropdownData';

export function getKindLabel(item: DropdownItem): string {
  switch (item.kind) {
    case 'mcp':
      return 'MCP tool';
    case 'command':
      return 'Command';
    case 'skill':
      return 'Skill';
  }
}

export function getItemMatchScore(item: DropdownItem, searchLower: string): number {
  if (!searchLower) return 0;

  const nameLower = item.name.toLowerCase();
  const serverToolLower = `${item.serverName ?? ''}/${item.toolName ?? ''}`.toLowerCase();
  const descriptionLower = item.description?.toLowerCase() ?? '';

  const titleScore = Math.min(
    getTextMatchScore(nameLower, searchLower),
    getTextMatchScore(serverToolLower, searchLower),
  );
  if (titleScore < Number.POSITIVE_INFINITY) return titleScore;

  const descriptionIndex = descriptionLower.indexOf(searchLower);
  if (descriptionIndex !== -1) return 300 + descriptionIndex;
  return Number.POSITIVE_INFINITY;
}

export function getTextMatchScore(textLower: string, searchLower: string): number {
  if (!textLower) return Number.POSITIVE_INFINITY;
  if (textLower === searchLower) return 0;
  if (textLower.startsWith(searchLower)) return 10 + textLower.length - searchLower.length;

  const boundaryIndex = getBoundaryMatchIndex(textLower, searchLower);
  if (boundaryIndex !== -1) return 40 + boundaryIndex;

  const includesIndex = textLower.indexOf(searchLower);
  if (includesIndex !== -1) return 70 + includesIndex;

  const fuzzyIndexes = getFuzzyMatchIndexes(textLower, searchLower);
  if (!fuzzyIndexes) return Number.POSITIVE_INFINITY;
  const spread = fuzzyIndexes[fuzzyIndexes.length - 1] - fuzzyIndexes[0];
  return 120 + fuzzyIndexes[0] + spread;
}

export function getBoundaryMatchIndex(textLower: string, searchLower: string): number {
  for (let i = 1; i < textLower.length; i++) {
    if (isSearchBoundary(textLower.charAt(i - 1)) && textLower.startsWith(searchLower, i)) {
      return i;
    }
  }
  return -1;
}

export function isSearchBoundary(ch: string): boolean {
  return ch === '-' || ch === '_' || ch === '/' || ch === ' ' || ch === '.';
}

export function getFuzzyMatchIndexes(textLower: string, searchLower: string): number[] | null {
  const indexes: number[] = [];
  let searchIndex = 0;

  for (let i = 0; i < textLower.length && searchIndex < searchLower.length; i++) {
    if (textLower.charAt(i) === searchLower.charAt(searchIndex)) {
      indexes.push(i);
      searchIndex++;
    }
  }

  return searchIndex === searchLower.length ? indexes : null;
}

export function appendHighlightedText(parent: HTMLElement, text: string, query: string): void {
  const queryLower = query.toLowerCase();
  if (!queryLower) {
    parent.createSpan({ text });
    return;
  }

  const textLower = text.toLowerCase();
  if (!textLower.includes(queryLower)) {
    if (!appendFuzzyHighlightedText(parent, text, queryLower)) {
      parent.createSpan({ text });
    }
    return;
  }

  let cursor = 0;
  let matchIndex = textLower.indexOf(queryLower, cursor);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parent.createSpan({ text: text.slice(cursor, matchIndex) });
    }
    parent.createSpan({ cls: 'pivi-slash-match', text: text.slice(matchIndex, matchIndex + query.length) });
    cursor = matchIndex + query.length;
    matchIndex = textLower.indexOf(queryLower, cursor);
  }

  if (cursor < text.length) {
    parent.createSpan({ text: text.slice(cursor) });
  }
}

export function appendFuzzyHighlightedText(parent: HTMLElement, text: string, queryLower: string): boolean {
  const indexes = getFuzzyMatchIndexes(text.toLowerCase(), queryLower);
  if (!indexes) return false;

  let cursor = 0;
  for (const index of indexes) {
    if (index > cursor) {
      parent.createSpan({ text: text.slice(cursor, index) });
    }
    parent.createSpan({ cls: 'pivi-slash-match', text: text.charAt(index) });
    cursor = index + 1;
  }

  if (cursor < text.length) {
    parent.createSpan({ text: text.slice(cursor) });
  }
  return true;
}