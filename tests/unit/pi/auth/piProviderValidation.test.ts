import {
  isSupportedPiModelKey,
  isSupportedPiProviderId,
  SUPPORTED_PI_PROVIDER_IDS,
} from '@pivi/pivi-agent-core/auth/piProviderValidation';

describe('pi provider validation', () => {
  it('recognizes the supported provider ids used by pi runtime defaults', () => {
    expect([...SUPPORTED_PI_PROVIDER_IDS]).toEqual([
      'anthropic',
      'deepseek',
      'google',
      'openai-codex',
      'opencode-go',
      'openrouter',
    ]);
    expect(isSupportedPiProviderId('anthropic')).toBe(true);
    expect(isSupportedPiProviderId('openrouter')).toBe(true);
    expect(isSupportedPiProviderId('not-a-provider')).toBe(false);
  });

  it('accepts model keys only when the provider prefix is supported', () => {
    expect(isSupportedPiModelKey('anthropic/claude-3')).toBe(true);
    expect(isSupportedPiModelKey('openrouter/openai/gpt-4.1')).toBe(true);
    expect(isSupportedPiModelKey('not-a-provider/model')).toBe(false);
    expect(isSupportedPiModelKey('no-slash')).toBe(false);
    expect(isSupportedPiModelKey('/missing-provider')).toBe(false);
  });
});
