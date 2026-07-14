import {
  asArray,
  asJson,
  asString,
  type WebFetchInput,
  type WebFetchResponse,
  type WebFetchToolDeps,
  type WebSearchInput,
  type WebSearchResponse,
  type WebSearchSource,
  type WebSearchToolDeps,
} from '../types';

const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/mcp';

async function callAnySearch(
  deps: Pick<WebSearchToolDeps, 'fetch'>,
  name: 'search' | 'extract',
  args: Record<string, unknown>,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'x-anysearch-client': 'pivi',
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await deps.fetch(ANYSEARCH_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`AnySearch ${name} failed: HTTP ${response.status} ${response.statusText}`);
  }
  let parsed: Record<string, unknown> | null;
  try {
    parsed = asJson(await response.json());
  } catch (error) {
    throw new Error(`AnySearch ${name} returned invalid JSON.`, { cause: error });
  }
  if (!parsed) throw new Error(`AnySearch ${name} returned a non-object response body.`);
  const rpcError = asJson(parsed.error);
  if (rpcError) {
    throw new Error(`AnySearch ${name} failed: ${asString(rpcError.message) ?? 'JSON-RPC error'}`);
  }
  const result = asJson(parsed.result);
  const content = asArray(result?.content) ?? [];
  const text = content
    .map(asJson)
    .find((entry) => entry?.type === 'text');
  const value = asString(text?.text)?.trim();
  if (!value) throw new Error(`AnySearch ${name} returned no text content.`);
  if (result?.isError === true) {
    throw new Error(`AnySearch ${name} failed: ${value}`);
  }
  return value;
}

export async function searchAnySearch(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  if (input.recency) {
    throw new Error('AnySearch does not support recency filters.');
  }
  const text = await callAnySearch(
    deps,
    'search',
    { query: input.query, max_results: Math.min(input.limit, 10) },
    apiKey,
    signal,
  );
  return {
    provider: 'anysearch',
    query: input.query,
    sources: parseAnySearchResults(text, Math.min(input.limit, 10)),
  };
}

export async function fetchAnySearch(
  deps: WebFetchToolDeps,
  input: WebFetchInput,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<WebFetchResponse> {
  const content = (await callAnySearch(deps, 'extract', { url: input.url }, apiKey, signal))
    .slice(0, input.maxChars)
    .trim();
  if (!content) throw new Error('AnySearch extract returned no readable content.');
  const title = /^#{1,3}\s+(.+)$/m.exec(content)?.[1]?.trim();
  return title
    ? { provider: 'anysearch', url: input.url, title, content }
    : { provider: 'anysearch', url: input.url, content };
}

function parseAnySearchResults(text: string, limit: number): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const blockPattern = /^###\s+\d+\.\s+(.+)\n([\s\S]*?)(?=^###\s+\d+\.|(?![\s\S]))/gm;
  for (const match of text.matchAll(blockPattern)) {
    const title = match[1]?.trim();
    const body = match[2] ?? '';
    const urlMatch = /^-\s+\*\*URL\*\*:\s*(https?:\/\/\S+)/m.exec(body);
    const url = urlMatch?.[1]?.trim();
    const urlLine = urlMatch?.[0];
    if (!title || !url || !urlLine) continue;
    const snippet = body
      .replace(urlLine, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2_000)
      .trim();
    sources.push(snippet ? { title, url, snippet } : { title, url });
    if (sources.length >= limit) break;
  }
  if (sources.length === 0 && !/\b0 results?\b/i.test(text)) {
    throw new Error('AnySearch search returned an unrecognized result format.');
  }
  return sources;
}
