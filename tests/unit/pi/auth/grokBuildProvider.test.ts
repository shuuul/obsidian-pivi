import {
  GROK_BUILD_BASE_URL,
  GROK_BUILD_MODELS,
  sanitizeGrokBuildPayload,
} from '@pivi/pivi-agent-core/engine/pi/grokBuildProvider';

describe('Grok Build subscription provider', () => {
  it('defines Composer 2.5 on the Grok inference proxy with required headers', () => {
    const composer = GROK_BUILD_MODELS.find((model) => model.id === 'grok-composer-2.5-fast');

    expect(composer).toMatchObject({
      api: 'openai-responses',
      provider: 'grok-build',
      baseUrl: GROK_BUILD_BASE_URL,
      reasoning: false,
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: null,
        medium: null,
        high: null,
        xhigh: null,
        max: null,
      },
      contextWindow: 200_000,
      maxTokens: 30_000,
      headers: {
        'x-grok-client-identifier': 'grok-pager',
        'x-grok-client-version': '0.2.91',
        'x-xai-token-auth': 'xai-grok-cli',
        'x-grok-model-override': 'grok-composer-2.5-fast',
      },
    });
    expect(composer?.headers?.['User-Agent']).toContain('grok-shell/0.2.91');
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
