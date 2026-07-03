import { createCodexImageGenerator } from '@pivi/pivi-agent-core/engine/pi/codexImageGenerator';

function jwtWithAccount(accountId: string): string {
  const payload = {
    'https://api.openai.com/auth': {
      chatgpt_account_id: accountId,
    },
  };
  return [
    'header',
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    'signature',
  ].join('.');
}

describe('createCodexImageGenerator', () => {
  it('posts to Codex responses with openai-codex auth and parses image SSE output', async () => {
    const fetch: jest.MockedFunction<(input: string | URL | Request, init?: RequestInit) => Promise<Response>> = jest.fn(async (_input, _init) => new Response([
      'data: {"type":"response.created","response":{"id":"resp-1"}}',
      '',
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","id":"img-1","result":"aGVsbG8=","revised_prompt":"revised"}}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp-1","usage":{"input_tokens":1}}}',
      '',
    ].join('\n'), { status: 200 }));
    const generator = createCodexImageGenerator({
      fetch,
      getAccessToken: async () => jwtWithAccount('acct-1'),
    });

    const result = await generator.generateImage({
      prompt: 'Generate a blue sword icon',
      outputFormat: 'webp',
      sessionId: 'session-1',
    });

    expect(fetch).toHaveBeenCalledWith('https://chatgpt.com/backend-api/codex/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: expect.stringContaining('Bearer '),
        'chatgpt-account-id': 'acct-1',
        originator: 'pivi',
        accept: 'text/event-stream',
      }),
    }));
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      prompt_cache_key: 'session-1',
      tools: [{ type: 'image_generation', output_format: 'webp' }],
    });
    expect(result).toMatchObject({
      data: 'aGVsbG8=',
      mimeType: 'image/webp',
      responseId: 'resp-1',
      imageGenerationId: 'img-1',
      revisedPrompt: 'revised',
    });
  });

  it('requires openai-codex credentials', async () => {
    const generator = createCodexImageGenerator({
      fetch: jest.fn(),
      getAccessToken: async () => undefined,
    });

    await expect(generator.generateImage({ prompt: 'draw' })).rejects.toThrow(/openai-codex provider/);
  });
});
