import {
  collectProviderLogoSlugs,
  getModelFallbackLucideIcon,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from '../../../../src/pi/ui/providerLogos';

describe('providerLogos', () => {
  it('extracts provider id from model value', () => {
    expect(getProviderIdFromModelValue('anthropic/claude-sonnet-4-20250514')).toBe('anthropic');
    expect(getProviderIdFromModelValue('no-slash')).toBeNull();
  });

  it('maps known pi-ai provider ids to LobeHub slugs', () => {
    expect(getProviderLogoSlug('anthropic')).toBe('anthropic');
    expect(getProviderLogoSlug('github-copilot')).toBe('githubcopilot');
    expect(getProviderLogoSlug('amazon-bedrock')).toBe('bedrock');
    expect(getProviderLogoSlug('unknown-vendor')).toBeNull();
  });

  it('resolves slug from full model value', () => {
    expect(getProviderLogoSlugFromModelValue('openai/gpt-4o')).toBe('openai');
    expect(getProviderLogoSlugFromModelValue('unknown/model')).toBeNull();
  });

  it('collects unique slugs from provider ids', () => {
    expect(collectProviderLogoSlugs(['anthropic', 'openai', 'github-copilot'])).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'githubcopilot']),
    );
  });

  it('formats display names', () => {
    expect(getProviderDisplayName('anthropic')).toBe('Anthropic');
    expect(getProviderDisplayName('custom-vendor')).toBe('Custom Vendor');
  });

  it('picks lucide fallback from model name patterns', () => {
    expect(getModelFallbackLucideIcon('x', 'Claude 3')).toBe('sparkles');
    expect(getModelFallbackLucideIcon('x', 'gpt-4o')).toBe('brain');
    expect(getModelFallbackLucideIcon('x', 'Unknown Model')).toBe('cpu');
  });
});
