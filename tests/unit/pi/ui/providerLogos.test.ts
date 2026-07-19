import {
  getLogoSlugForCustomProviderKind,
  getModelFallbackLucideIcon,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from '@pivi/pivi-agent-core/foundation/providerLogos';

describe('providerLogos', () => {

  it('extracts provider id from model value', () => {
    expect(getProviderIdFromModelValue('anthropic/claude-sonnet-4-20250514')).toBe('anthropic');
    expect(getProviderIdFromModelValue('no-slash')).toBeNull();
  });

  it('maps known pi-ai provider ids to lobe-icons slugs', () => {
    expect(getProviderLogoSlug('anthropic')).toBe('anthropic');
    expect(getProviderLogoSlug('deepseek')).toBe('deepseek');
    expect(getProviderLogoSlug('google')).toBe('google');
    expect(getProviderLogoSlug('kimi-coding')).toBe('kimi');
    expect(getProviderLogoSlug('minimax-cn')).toBe('minimax');
    expect(getProviderLogoSlug('moonshotai')).toBe('moonshot');
    expect(getProviderLogoSlug('openai')).toBe('openai');
    expect(getProviderLogoSlug('openai-codex')).toBe('openai');
    expect(getProviderLogoSlug('opencode')).toBe('opencode');
    expect(getProviderLogoSlug('opencode-go')).toBe('opencode');
    expect(getProviderLogoSlug('openrouter')).toBe('openrouter');
    expect(getProviderLogoSlug('xiaomi-token-plan-cn')).toBe('xiaomimimo');
    expect(getProviderLogoSlug('zai-coding-cn')).toBe('zai');
    expect(getProviderLogoSlug('ollama')).toBe('ollama');
    expect(getProviderLogoSlug('lmstudio')).toBe('lmstudio');
    expect(getProviderLogoSlug('llama-cpp')).toBe('llama-cpp');
    expect(getLogoSlugForCustomProviderKind('llama-cpp')).toBe('llama-cpp');
    expect(getProviderLogoSlug('github-copilot')).toBeNull();
    expect(getProviderLogoSlug('amazon-bedrock')).toBeNull();
    expect(getProviderLogoSlug('unknown-vendor')).toBeNull();
  });


  it('resolves slug from full model value', () => {
    expect(getProviderLogoSlugFromModelValue('openai-codex/gpt-5')).toBe('openai');
    expect(getProviderLogoSlugFromModelValue('moonshotai/kimi-k2-thinking')).toBe('moonshot');
    expect(getProviderLogoSlugFromModelValue('unknown/model')).toBeNull();
  });


  it('formats display names', () => {
    expect(getProviderDisplayName('anthropic')).toBe('Anthropic');
    expect(getProviderDisplayName('kimi-coding')).toBe('Kimi For Coding');
    expect(getProviderDisplayName('opencode-go')).toBe('OpenCode Go');
    expect(getProviderDisplayName('zai-coding-cn')).toBe('Z.AI Coding CN');
    expect(getProviderDisplayName('custom-vendor')).toBe('Custom Vendor');
  });

  it('picks lucide fallback from model name patterns', () => {
    expect(getModelFallbackLucideIcon('x', 'Claude 3')).toBe('sparkles');
    expect(getModelFallbackLucideIcon('x', 'gpt-4o')).toBe('brain');
    expect(getModelFallbackLucideIcon('x', 'Unknown Model')).toBe('cpu');
  });
});
