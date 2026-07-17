import {
  createGrokBuildProvider,
  GROK_BUILD_BASE_URL,
  sanitizeGrokBuildPayload,
} from '@pivi/pivi-agent-core/engine/pi/grokBuildProvider';
import type { Provider } from '@earendil-works/pi-ai';

describe('Grok Build subscription provider', () => {
  it('mirrors only the upstream xAI model list into the subscription proxy', () => {
    const xaiModels = [
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        api: 'openai-responses',
        provider: 'xai',
        baseUrl: 'https://api.x.ai/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 500_000,
        maxTokens: 30_000,
      },
      {
        id: 'grok-build-0.1',
        name: 'Grok Build 0.1',
        api: 'openai-completions',
        provider: 'xai',
        baseUrl: 'https://api.x.ai/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 256_000,
        maxTokens: 30_000,
      },
    ];
    const provider = createGrokBuildProvider({
      auth: { oauth: {} },
      getModels: () => xaiModels,
    } as unknown as Provider);

    expect(provider.getModels()).toEqual(xaiModels.map(source => expect.objectContaining({
      id: source.id,
      name: source.name,
      api: 'openai-responses',
      provider: 'grok-build',
      baseUrl: GROK_BUILD_BASE_URL,
      contextWindow: source.contextWindow,
      headers: expect.objectContaining({
        'x-grok-model-override': source.id,
        'x-xai-token-auth': 'xai-grok-cli',
      }),
    })));
    expect(provider.getModels().some(model => model.id.includes('composer'))).toBe(false);
  });

  it('normalizes Responses payloads for the Grok Build proxy', () => {
    expect(sanitizeGrokBuildPayload({
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'Follow vault rules.' }] },
        { type: 'reasoning', encrypted_content: 'replayed-secret' },
        { role: 'user', content: 'Hello' },
        '',
      ],
      response_format: { type: 'json_schema', name: 'result' },
      include: ['reasoning.encrypted_content'],
      prompt_cache_retention: '24h',
    }, 'session-123')).toEqual({
      input: [{ role: 'user', content: 'Hello' }],
      instructions: 'Follow vault rules.',
      text: { format: { type: 'json_schema', name: 'result' } },
      prompt_cache_key: 'session-123',
    });
  });

  it('preserves non-object payloads', () => {
    expect(sanitizeGrokBuildPayload('raw')).toBe('raw');
  });
});
