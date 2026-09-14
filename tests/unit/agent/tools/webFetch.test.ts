import {
  createWebFetchTool,
  type WebSearchFetch,
  type WebFetchToolDeps,
} from '@pivi/agent/tools';

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
    providerOrder: ['exa'],
    disabledProviders: [],
    environmentVariables: {},
    ...overrides,
  };
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

describe('createWebFetchTool local truncation', () => {
  it('truncates oversized Exa content to maxChars', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        results: [{
          url: 'https://example.com/exa',
          title: 'Exa page',
          text: `${'x'.repeat(900)}END`,
        }],
      }),
    );
    const tool = createWebFetchTool(makeDeps({
      fetch: fetch as unknown as WebSearchFetch,
      getCredential: (id) => (id === 'exa' ? 'exa-key' : undefined),
    }));

    const result = await tool.execute('id', {
      url: 'https://example.com/exa',
      maxChars: 500,
    });
    const text = toolResultText(result);

    expect(text).toContain('Provider: exa');
    expect(text).toContain('Title: Exa page');
    expect(text).not.toContain('END');
    const content = text.split('\n\n')[1] ?? '';
    expect(content.length).toBeLessThanOrEqual(500);
  });
});
