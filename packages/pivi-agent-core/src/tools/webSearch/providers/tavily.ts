import {
  asArray,
  asJson,
  asString,
  isAbortError,
  tavilyTimeRange,
  type WebSearchInput,
  type WebSearchResponse,
  type WebSearchSource,
  type WebSearchToolDeps,
} from '../types';

export async function searchTavily(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const payload: Record<string, unknown> = {
    query: input.query,
    max_results: input.limit,
    search_depth: 'basic',
    include_answer: 'advanced',
  };
  const timeRange = tavilyTimeRange(input.recency);
  if (timeRange) {
    payload.time_range = timeRange;
  }

  const doRequest = async (body: Record<string, unknown>): Promise<WebSearchResponse> => {
    const response = await deps.fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed: HTTP ${response.status} ${response.statusText}`);
    }
    const parsed = asJson(await response.json());
    if (!parsed) {
      throw new Error('Tavily search returned a non-object response body.');
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
      const content = asString(record.content);
      if (content) source.snippet = content;
      sources.push(source);
    }
    const answer = asString(parsed.answer);
    return { provider: 'tavily', query: input.query, summary: answer, sources };
  };

  try {
    const result = await doRequest(payload);
    // Retry without recency filter when a recency-filtered query returns no renderable content.
    if (input.recency && result.sources.length === 0 && !result.summary) {
      const relaxed = { ...payload };
      delete relaxed.time_range;
      return doRequest(relaxed);
    }
    return result;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    if (input.recency) {
      const relaxed = { ...payload };
      delete relaxed.time_range;
      return doRequest(relaxed);
    }
    throw error;
  }
}
