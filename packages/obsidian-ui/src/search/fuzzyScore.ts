export function getTextMatchScore(textLower: string, searchLower: string): number {
  if (!textLower) return Number.POSITIVE_INFINITY;
  if (textLower === searchLower) return 0;
  if (textLower.startsWith(searchLower)) return 10 + textLower.length - searchLower.length;

  const boundaryIndex = getBoundaryMatchIndex(textLower, searchLower);
  if (boundaryIndex !== -1) return 40 + boundaryIndex;

  const includesIndex = textLower.indexOf(searchLower);
  if (includesIndex !== -1) return 70 + includesIndex;

  const fuzzyIndexes = getFuzzyMatchIndexes(textLower, searchLower);
  if (!fuzzyIndexes || fuzzyIndexes.length === 0) return Number.POSITIVE_INFINITY;
  const firstIndex = fuzzyIndexes[0];
  const lastIndex = fuzzyIndexes[fuzzyIndexes.length - 1];
  if (firstIndex === undefined || lastIndex === undefined) return Number.POSITIVE_INFINITY;
  return 120 + firstIndex + lastIndex - firstIndex;
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
