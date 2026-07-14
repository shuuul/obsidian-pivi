import {
  createWebFetchTool,
  type WebSearchFetch,
  type WebFetchToolDeps,
} from '@pivi/pivi-agent-core/tools';

type FetchMock = jest.Mock<Response, [string | URL | Request, RequestInit?]>;

function makeResponse(
  body: unknown,
  ok = true,
  status = 200,
  statusText = 'OK',
): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makeDeps(overrides: Partial<WebFetchToolDeps> = {}): WebFetchToolDeps {
  return {
    fetch: jest.fn(async () => makeResponse({})),
    providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
    disabledProviders: [],
    environmentVariables: {},
    ...overrides,
  };
}

function asMock(fetch: unknown): FetchMock {
  return fetch as FetchMock;
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

describe('createWebFetchTool', () => {
  it('uses the WebFetch tool name', () => {
    const tool = createWebFetchTool(makeDeps());
    expect(tool.name).toBe('WebFetch');
    expect(tool.parameters.properties).not.toHaveProperty('provider');
  });

  it('rejects missing url', async () => {
    const tool = createWebFetchTool(makeDeps());
    await expect(tool.execute('id', {})).rejects.toThrow(/url is required/);
  });

  it('rejects non-http(s) url', async () => {
    const tool = createWebFetchTool(makeDeps());
    await expect(tool.execute('id', { url: 'ftp://example.com/a' })).rejects.toThrow(
      /url must be http\(s\)/,
    );
    await expect(tool.execute('id', { url: 'not-a-url' })).rejects.toThrow(/url must be http\(s\)/);
  });

  it('constructs Tavily extract request with Bearer auth and optional query', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        results: [{ url: 'https://example.com/a', raw_content: '# Main\nContent here' }],
      }),
    );
    const tool = createWebFetchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'tavily' ? 'tavily-key' : undefined),
      }),
    );

    const result = await tool.execute('id', {
      url: 'https://example.com/a',
      query: 'main point',
    });
    const init = asMock(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);

    expect(asMock(fetch).mock.calls[0]![0]).toBe('https://api.tavily.com/extract');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tavily-key');
    expect(body.urls).toBe('https://example.com/a');
    expect(body.extract_depth).toBe('basic');
    expect(body.format).toBe('markdown');
    expect(body.query).toBe('main point');

    const text = toolResultText(result);
    expect(text).toContain('Provider: tavily');
    expect(text).toContain('Main');
  });

  it('constructs Exa contents request with x-api-key, text maxCharacters, and summary query', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        results: [{ url: 'https://example.com/b', title: 'Page B', text: 'exa body text' }],
      }),
    );
    const tool = createWebFetchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        getCredential: (id) => (id === 'exa' ? 'exa-key' : undefined),
      }),
    );

    const result = await tool.execute('id', {
      url: 'https://example.com/b',
      query: 'summarize',
      maxChars: 8000,
    });
    const init = asMock(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);

    expect(asMock(fetch).mock.calls[0]![0]).toBe('https://api.exa.ai/contents');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('exa-key');
    expect(body.urls).toEqual(['https://example.com/b']);
    expect(body.text.maxCharacters).toBe(8000);
    expect(body.text.includeHtmlTags).toBe(false);
    expect(body.summary).toEqual({ query: 'summarize' });

    const text = toolResultText(result);
    expect(text).toContain('Provider: exa');
    expect(text).toContain('Title: Page B');
    expect(text).toContain('exa body text');
  });

  it('tries preferred fetch provider first when credentialed', async () => {
    const fetch = jest.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('exa.ai')) {
        return makeResponse({
          results: [{ url: 'https://example.com/c', text: 'from exa' }],
        });
      }
      return makeResponse({ results: [] });
    });
    const tool = createWebFetchTool(
      makeDeps({
        fetch: fetch as unknown as WebSearchFetch,
        providerOrder: ['exa', 'tavily', 'anysearch'],
        getCredential: (id) =>
          id === 'exa' ? 'exa-key' : id === 'tavily' ? 'tavily-key' : undefined,
      }),
    );

    await tool.execute('id', { url: 'https://example.com/c' });
    expect(asMock(fetch).mock.calls[0]![0]).toBe('https://api.exa.ai/contents');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('auto skips uncredentialed providers and falls back to direct HTTP', async () => {
    const html =
      '<html><body><p>Hello <b>world</b></p><script>x()</script></body></html>';
    const fetch = jest.fn(async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.startsWith('https://example.com/a')) {
        return makeResponse(html);
      }
      return makeResponse({ results: [] });
    });
    const tool = createWebFetchTool(makeDeps({ fetch: fetch as unknown as WebSearchFetch, providerOrder: [] }));

    const result = await tool.execute('id', { url: 'https://example.com/a', maxChars: 20 });
    const text = toolResultText(result);

    expect(text).toContain('Provider: direct');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('script');
    expect(text).not.toContain('x()');
  });

  it('uses anonymous AnySearch extract and truncates markdown', async () => {
    const content = `# Page\n\n${'x'.repeat(700)}END`;
    const fetch = jest.fn(async () => makeResponse({
      result: { content: [{ type: 'text', text: content }] },
    }));
    const tool = createWebFetchTool(makeDeps({
      fetch: fetch as unknown as WebSearchFetch,
      providerOrder: ['anysearch'],
    }));

    const result = await tool.execute('id', { url: 'https://example.com/a', maxChars: 500 });
    const call = asMock(fetch).mock.calls[0]!;
    const headers = call[1]!.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(toolResultText(result)).toContain('Provider: anysearch');
    expect(toolResultText(result)).toContain('# Page');
    expect(toolResultText(result)).not.toContain('END');
  });

  it('falls back to direct HTTP after AnySearch quota exhaustion', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ result: { isError: true, content: [{ type: 'text', text: 'Quota exhausted' }] } }))
      .mockResolvedValueOnce(makeResponse('<html><body><p>Direct fallback</p></body></html>'));
    const tool = createWebFetchTool(makeDeps({
      fetch: fetch as unknown as WebSearchFetch,
      providerOrder: ['anysearch'],
    }));

    const result = await tool.execute('id', { url: 'https://example.com/fallback' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(toolResultText(result)).toContain('Provider: direct');
    expect(toolResultText(result)).toContain('Direct fallback');
  });

  it('throws an aggregate error when every fetch provider fails', async () => {
    const fetch = jest.fn(async () => makeResponse({}, false, 503, 'Unavailable'));
    const tool = createWebFetchTool(makeDeps({
      fetch: fetch as unknown as WebSearchFetch,
      providerOrder: [],
    }));

    await expect(tool.execute('id', { url: 'https://example.com/fail' })).rejects.toThrow(
      /No web fetch content found.*direct/s,
    );
  });
});
