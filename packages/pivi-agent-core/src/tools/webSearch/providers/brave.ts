import {
  asArray,
  asJson,
  asString,
  braveFreshness,
  type WebSearchInput,
  type WebSearchResponse,
  type WebSearchSource,
  type WebSearchToolDeps,
} from '../types';

export async function searchBrave(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', input.query);
  url.searchParams.set('count', String(input.limit));
  const freshness = braveFreshness(input.recency);
  if (freshness) {
    url.searchParams.set('freshness', freshness);
  }

  const response = await deps.fetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-subscription-token': apiKey,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = asJson(await response.json());
  if (!body) {
    throw new Error('Brave search returned a non-object response body.');
  }

  const web = asJson(body.web);
  const results = asArray(web?.results) ?? [];
  const sources: WebSearchSource[] = [];
  for (const entry of results.slice(0, input.limit)) {
    const record = asJson(entry);
    if (!record) continue;
    const title = asString(record.title) ?? '';
    const link = asString(record.url) ?? asString(record.link) ?? '';
    if (!title || !link) continue;
    const source: WebSearchSource = { title, url: link };
    const description = asString(record.description);
    if (description) source.snippet = description;
    sources.push(source);
  }

  return { provider: 'brave', query: input.query, sources };
}
