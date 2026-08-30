import type { ChatUIOption } from '@pivi/agent/runtime/chatUi';

const MAX_CATALOG_CANDIDATES = 5;

function normalizeModelText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stripRuntimeFormatSuffix(value: string): string {
  return value.replace(/(?:[-_/\s](?:nvfp4|exl3))+$/gi, '');
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (
          left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
        ),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? right.length;
}

function modelTextScore(candidate: string, query: string): number {
  const text = normalizeModelText(candidate);
  if (text === query) return 0;
  if (text.startsWith(query) || query.startsWith(text)) {
    return 10 + Math.abs(text.length - query.length);
  }
  const includesIndex = text.indexOf(query);
  if (includesIndex >= 0) {
    return 30 + includesIndex + Math.abs(text.length - query.length);
  }
  const distance = editDistance(text, query);
  return 100 + (distance / Math.max(text.length, query.length, 1)) * 100;
}

function catalogCandidateScore(option: ChatUIOption, query: string): number {
  const slash = option.value.indexOf('/');
  const modelId = slash >= 0 ? option.value.slice(slash + 1) : option.value;
  return Math.min(
    modelTextScore(option.value, query),
    modelTextScore(modelId, query),
    modelTextScore(option.label, query),
  );
}

/** Rank built-in catalog rows against the draft, or the provider model name while empty. */
export function matchCatalogModels(
  options: readonly ChatUIOption[],
  draft: string,
  providerModelName: string,
): ChatUIOption[] {
  const query = normalizeModelText(stripRuntimeFormatSuffix(draft.trim() || providerModelName));
  if (!query) {
    return options.slice(0, MAX_CATALOG_CANDIDATES);
  }
  return options
    .map((option) => ({ option, score: catalogCandidateScore(option, query) }))
    .sort((left, right) => left.score - right.score || left.option.value.localeCompare(right.option.value))
    .slice(0, MAX_CATALOG_CANDIDATES)
    .map(({ option }) => option);
}
