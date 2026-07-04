import {
  createWebSearchTool,
  type WebSearchFetch,
  type WebSearchToolDeps,
} from '@pivi/pivi-agent-core/tools';
import type { WebSearchProviderChoice } from '@pivi/pivi-agent-core/foundation/settings';

type FetchMock = jest.Mock<Response, [string, RequestInit?]>;

function makeResponse(body: unknown, ok = true, status = 200, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makeDeps(overrides: Partial<WebSearchToolDeps> = {}): WebSearchToolDeps {
  return {
    fetch: jest.fn(async () => makeResponse({})) as unknown as WebSearchFetch,
    preferredProvider: 'auto',
    environmentVariables: {},
    ...overrides,
  };
}

function asMock(fetch: WebSearchFetch): FetchMock {
  return fetch as unknown as FetchMock;
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('unexpected tool result');
  }
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('unexpected tool result content');
  }
  const first = content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('unexpected tool result text');
  }
  return first.text;
}

describe('createWebSearchTool', () => {
  it('uses the WebSearch tool name', () => {
    const tool = createWebSearchTool(makeDeps());
    expect(tool.name).toBe('WebSearch');
  });

  it('rejects empty query', async () => {
    const tool = createWebSearchTool(makeDeps());
    await expect(tool.execute('id', { query: '' })).rejects.toThrow(/non-empty.*query/);
  });

  it('rejects missing query', async () => {
    const tool = createWebSearchTool(makeDeps());
    await expect(tool.execute('id', {})).rejects.toThrow();
  });

  it('constructs Brave request with X-Subscription-Token and freshness', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({ web: { results: [{ title: 'A', url: 'https://a.com' }] } }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'brave' ? 'brave-key' : undefined),
      }),
    );

    const result = await tool.execute('id', { query: 'test', recency: 'week', provider: 'brave' });
    const call = asMock(fetch).mock.calls[0];
    const url = call[0];
    const init = call[1];

    expect(url).toContain('api.search.brave.com');
    expect(url).toContain('q=test');
    expect(url).toContain('freshness=pw');
    expect((init!.headers as Record<string, string>)['x-subscription-token']).toBe('brave-key');
    const text = toolResultText(result);
    expect(text).toContain('Links: [{"title":"A","url":"https://a.com"}]');
    expect(text).toContain('Provider: brave');
  });

  it('constructs Tavily POST with Bearer auth and time_range', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        results: [{ title: 'T', url: 'https://t.com', content: 'snippet' }],
        answer: 'summary text',
      }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        environmentVariables: { TAVILY_API_KEY: 'tavily-key' },
      }),
    );

    const result = await tool.execute('id', { query: 'hello', recency: 'month', provider: 'tavily' });
    const init = asMock(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);

    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tavily-key');
    expect(body.query).toBe('hello');
    expect(body.time_range).toBe('month');
    expect(body.search_depth).toBe('basic');
    expect(body.include_answer).toBe('advanced');

    const text = toolResultText(result);
    expect(text).toContain('Provider: tavily');
    expect(text).toContain('Summary: summary text');
  });

  it('retries Tavily without time_range when recency filter returns no results', async () => {
    const fetch = jest.fn();
    fetch
      .mockResolvedValueOnce(makeResponse({ results: [], answer: undefined }))
      .mockResolvedValueOnce(
        makeResponse({ results: [{ title: 'T2', url: 'https://t2.com' }] }),
      );

    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'tavily' ? 'tavily-key' : undefined),
      }),
    );

    const result = await tool.execute('id', { query: 'old news', recency: 'day', provider: 'tavily' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(asMock(fetch).mock.calls[1]![1]!.body as string);
    expect(secondBody.time_range).toBeUndefined();
    const text = toolResultText(result);
    expect(text).toContain('https://t2.com');
  });

  it('constructs Exa POST with x-api-key and startPublishedDate', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({ results: [{ title: 'E', url: 'https://e.com', text: { text: 'exa snippet' } }] }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'exa' ? 'exa-key' : undefined),
      }),
    );

    const result = await tool.execute('id', { query: 'exa test', recency: 'year', provider: 'exa' });
    const init = asMock(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);

    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('exa-key');
    expect(body.query).toBe('exa test');
    expect(typeof body.startPublishedDate).toBe('string');

    const text = toolResultText(result);
    expect(text).toContain('Provider: exa');
    expect(text).toContain('https://e.com');
  });

  it('falls through auto chain to Exa MCP when no credentials are configured', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        result: {
          content: [{ type: 'text', text: 'Result A - https://mcp-a.com' }],
        },
      }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
      }),
    );

    const result = await tool.execute('id', { query: 'no creds' });
    const url = asMock(fetch).mock.calls[0]![0];
    expect(url).toContain('mcp.exa.ai');
    const text = toolResultText(result);
    expect(text).toContain('https://mcp-a.com');
    expect(text).toContain('Provider: exa-mcp');
  });

  it('skips providers without credentials in auto chain', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({ web: { results: [{ title: 'Brave', url: 'https://brave.com' }] } }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'brave' ? 'brave-key' : undefined),
      }),
    );

    await tool.execute('id', { query: 'brave only' });
    const url = asMock(fetch).mock.calls[0]![0];
    expect(url).toContain('api.search.brave.com');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tries preferred provider first in auto chain', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({ results: [{ title: 'T', url: 'https://t.com' }] }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        preferredProvider: 'tavily',
        getCredential: (id) =>
          id === 'tavily' ? 'tavily-key' : id === 'brave' ? 'brave-key' : undefined,
      }),
    );

    await tool.execute('id', { query: 'preferred test' });
    const url = asMock(fetch).mock.calls[0]![0];
    expect(url).toContain('api.tavily.com');
  });

  it('returns no-results message when all providers fail', async () => {
    const fetch = jest.fn(async () => makeResponse({}, false, 401, 'Unauthorized'));
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
      }),
    );

    const result = await tool.execute('id', { query: 'nothing' });
    const text = toolResultText(result);
    expect(text).toContain('No web search results found');
  });

  it('respects limit and num_search_results alias', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        web: { results: Array.from({ length: 15 }, (_, i) => ({ title: `R${i}`, url: `https://r${i}.com` })) },
      }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'brave' ? 'brave-key' : undefined),
      }),
    );

    const result = await tool.execute('id', { query: 'many', num_search_results: 5, provider: 'brave' });
    const text = toolResultText(result);
    const linksMatch = text.match(/Links:\s*(\[[\s\S]*?\])/);
    const links = JSON.parse(linksMatch![1]);
    expect(links).toHaveLength(5);
  });

  it('throws when a specific provider has no API key', async () => {
    const fetch = jest.fn();
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
      }),
    );

    await expect(tool.execute('id', { query: 'no key', provider: 'brave' })).rejects.toThrow(/Brave API key not configured/);
  });

  it('provider auto in input falls through to chain', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({ web: { results: [{ title: 'Brave', url: 'https://brave.com' }] } }),
    );
    const tool = createWebSearchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        preferredProvider: 'auto' as WebSearchProviderChoice,
        getCredential: (id) => (id === 'brave' ? 'brave-key' : undefined),
      }),
    );

    await tool.execute('id', { query: 'auto as provider', provider: 'auto' });
    const url = asMock(fetch).mock.calls[0]![0];
    expect(url).toContain('api.search.brave.com');
  });
});