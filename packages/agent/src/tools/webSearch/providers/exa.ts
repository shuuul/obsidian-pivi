import {
  asArray,
  asJson,
  asString,
  publishedDateCutoff,
  type WebSearchInput,
  type WebSearchResponse,
  type WebSearchSource,
  type WebSearchToolDeps,
} from '../types';

export async function searchExa(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const payload: Record<string, unknown> = {
    query: input.query,
    numResults: input.limit,
    contents: { text: { maxCharacters: 200 } },
  };
  if (input.recency) {
    payload.startPublishedDate = publishedDateCutoff(input.recency);
  }

  const response = await deps.fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Exa search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Exa search returned a non-object response body.');
  }
  const rawResults = asArray(parsed.results) ?? [];
  const sources: WebSearchSource[] = [];
  for (const entry of rawResults.slice(0, input.limit)) {
    const record = asJson(entry);
    if (!record) continue;
    const title = asString(record.title) ?? '';
    const link = asString(record.url) ?? '';
    if (!title || !link) continue;
    const source: WebSearchSource = { title, url: link };
    const textRecord = asJson(record.text);
    const text = asString(textRecord?.text);
    if (text) source.snippet = text;
    sources.push(source);
  }
  return { provider: 'exa', query: input.query, sources };
}
