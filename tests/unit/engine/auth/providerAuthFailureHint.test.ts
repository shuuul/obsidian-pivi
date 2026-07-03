import { getProviderAuthFailureHint } from '@pivi/pivi-agent-core/auth/providerAuthFailureHint';

describe('getProviderAuthFailureHint', () => {
  it('returns the Codex OAuth reconnect hint for openai-codex', () => {
    expect(getProviderAuthFailureHint('openai-codex')).toBe(
      'Provider: openai-codex. Reconnect OpenAI Codex OAuth in provider settings.',
    );
  });

  it('returns the canonical API key env var for a known provider', () => {
    expect(getProviderAuthFailureHint('anthropic')).toBe(
      'Provider: anthropic. Expected env var: ANTHROPIC_API_KEY',
    );
    expect(getProviderAuthFailureHint('openai')).toBe(
      'Provider: openai. Expected env var: OPENAI_API_KEY',
    );
  });

  it('returns GOOGLE_CLOUD_API_KEY for google-vertex', () => {
    expect(getProviderAuthFailureHint('google-vertex')).toBe(
      'Provider: google-vertex. Expected env var: GOOGLE_CLOUD_API_KEY',
    );
  });

  it('derives fallback env var from dashed provider ids', () => {
    expect(getProviderAuthFailureHint('my-custom-provider')).toBe(
      'Provider: my-custom-provider. Expected env var: MY_CUSTOM_PROVIDER_API_KEY',
    );
  });
});