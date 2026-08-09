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

export async function searchExaMcp(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  // Exa public MCP fallback: a single POST that searches the web via the public endpoint.
  const response = await deps.fetch('https://mcp.exa.ai/mcp?tools=web_search_exa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: input.query,
          numResults: input.limit,
          startPublishedDate: input.recency ? publishedDateCutoff(input.recency) : undefined,
        },
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Exa MCP search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Exa MCP search returned a non-object response body.');
  }
  const result = asJson(parsed.result);
  const content = asArray(result?.content) ?? [];
  let text: string | undefined;
  for (const entry of content) {
    const record = asJson(entry);
    if (record && record.type === 'text') {
      const candidate = asString(record.text);
      if (candidate) {
        text = candidate;
        break;
      }
    }
  }
  if (!text) {
    return { provider: 'exa-mcp', query: input.query, sources: [] };
  }
  const sources = parseExaMcpText(text, input.limit);
  return { provider: 'exa-mcp', query: input.query, sources };
}

function parseExaMcpText(text: string, limit: number): WebSearchSource[] {
  // The Exa MCP text content is a newline-delimited list of "<title> - <url>" entries
  // or JSON-encoded results. Try JSON first, fall back to line parsing.
  try {
    const parsed: unknown = JSON.parse(text);
    const arr = asArray(parsed);
    if (arr) {
      const sources: WebSearchSource[] = [];
      for (const entry of arr.slice(0, limit)) {
        const record = asJson(entry);
        if (!record) continue;
        const title = asString(record.title) ?? '';
        const url = asString(record.url) ?? '';
        if (title && url) sources.push({ title, url });
      }
      if (sources.length > 0) return sources;
    }
  } catch {
    // Not JSON; fall through to line parsing.
  }
  const sources: WebSearchSource[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const dashIndex = trimmed.lastIndexOf(' - ');
    if (dashIndex > 0) {
      const title = trimmed.slice(0, dashIndex).trim();
      const url = trimmed.slice(dashIndex + 3).trim();
      if (title && /^https?:\/\//i.test(url)) {
        sources.push({ title, url });
      }
    }
    if (sources.length >= limit) break;
  }
  return sources;
}
