import { setIcon } from 'obsidian';

import {
  getModelFallbackLucideIcon,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from '@pivi/pivi-agent-core/foundation/providerLogos';
import { appendProviderLogo } from '@/ui/shared/utils/providerLogoDom';

class FakeStyle {
  private properties = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? '';
  }
}

class FakeElement {
  children: FakeElement[] = [];
  className = '';
  style = new FakeStyle();

  constructor(className = '') {
    this.className = className;
  }

  createSpan(options?: { cls?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement(options?.cls);
    this.children.push(child);
    return child;
  }
}

describe('providerLogos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts provider id from model value', () => {
    expect(getProviderIdFromModelValue('anthropic/claude-sonnet-4-20250514')).toBe('anthropic');
    expect(getProviderIdFromModelValue('no-slash')).toBeNull();
  });

  it('maps known pi-ai provider ids to local icon slugs', () => {
    expect(getProviderLogoSlug('anthropic')).toBe('anthropic');
    expect(getProviderLogoSlug('deepseek')).toBe('deepseek');
    expect(getProviderLogoSlug('google')).toBe('google');
    expect(getProviderLogoSlug('openai-codex')).toBe('openai');
    expect(getProviderLogoSlug('opencode-go')).toBe('opencode');
    expect(getProviderLogoSlug('openrouter')).toBe('openrouter');
    expect(getProviderLogoSlug('github-copilot')).toBeNull();
    expect(getProviderLogoSlug('amazon-bedrock')).toBeNull();
    expect(getProviderLogoSlug('unknown-vendor')).toBeNull();
  });

  it('renders supported provider slugs from bundled SVG masks instead of Lucide fallbacks', () => {
    for (const slug of ['anthropic', 'deepseek', 'google', 'openai', 'opencode', 'openrouter']) {
      const parent = new FakeElement();

      const logo = appendProviderLogo(parent as unknown as HTMLElement, slug) as unknown as FakeElement;

      expect(logo.className).toContain('pivi-provider-logo-mask');
      expect(logo.className).not.toContain('pivi-provider-logo-lucide');
      expect(logo.style.getPropertyValue('mask-image')).toContain('data:image/svg+xml');
    }
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('falls back to a local Lucide icon for unknown provider slugs', () => {
    const parent = new FakeElement();

    const logo = appendProviderLogo(parent as unknown as HTMLElement, 'unknown-vendor', {
      className: 'extra-logo-class',
      size: 16,
    }) as unknown as FakeElement;

    expect(logo.className).toContain('pivi-provider-logo-lucide');
    expect(logo.className).toContain('extra-logo-class');
    expect(logo.style.getPropertyValue('--pivi-provider-logo-size')).toBe('16px');
    expect(setIcon).toHaveBeenCalledWith(logo, 'cpu');
  });

  it('resolves slug from full model value', () => {
    expect(getProviderLogoSlugFromModelValue('openai-codex/gpt-5')).toBe('openai');
    expect(getProviderLogoSlugFromModelValue('unknown/model')).toBeNull();
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
