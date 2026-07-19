import type { Api, Model } from '@earendil-works/pi-ai';

import {
  buildPiModelOptions,
  cachePiAiRegistryModels,
  getPiAiModelsForProvider,
  PI_AI_MODELS_CACHE,
  type PiModelLookup,
  type PiModelRegistryProvider,
  resolvePiModelFromKeyWithLookup,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';

function modelFixture(overrides: Partial<Model<Api>> & Pick<Model<Api>, 'provider' | 'id'>): Model<Api> {
  return {
    name: overrides.id,
    reasoning: false,
    contextWindow: 128_000,
    ...overrides,
  } as Model<Api>;
}

describe('PiModelRegistry (core)', () => {
  beforeEach(() => {
    PI_AI_MODELS_CACHE.clear();
  });

  afterEach(() => {
    PI_AI_MODELS_CACHE.clear();
  });

  describe('cachePiAiRegistryModels', () => {
    it('warms the shared cache from an injected registry provider', () => {
      const alpha = modelFixture({ provider: 'anthropic', id: 'alpha', name: 'Alpha' });
      const beta = modelFixture({ provider: 'openai', id: 'beta', name: 'Beta' });
      const registry: PiModelRegistryProvider = {
        getProviders: () => [{ id: 'anthropic' }, { id: 'openai' }],
        getModels: (providerId) => (providerId === 'anthropic' ? [alpha] : [beta]),
      };

      cachePiAiRegistryModels(registry);

      expect(PI_AI_MODELS_CACHE.get('anthropic/alpha')).toBe(alpha);
      expect(PI_AI_MODELS_CACHE.get('openai/beta')).toBe(beta);
    });

    it('replaces the previous cache snapshot', () => {
      const staleProviderModel = modelFixture({ provider: 'removed', id: 'stale' });
      const staleRetainedModel = modelFixture({ provider: 'anthropic', id: 'old' });
      const currentModel = modelFixture({ provider: 'anthropic', id: 'current' });
      PI_AI_MODELS_CACHE.set('removed/stale', staleProviderModel);
      PI_AI_MODELS_CACHE.set('anthropic/old', staleRetainedModel);
      const registry: PiModelRegistryProvider = {
        getProviders: () => [{ id: 'anthropic' }],
        getModels: () => [currentModel],
      };

      cachePiAiRegistryModels(registry);

      expect([...PI_AI_MODELS_CACHE.entries()]).toEqual([
        ['anthropic/current', currentModel],
      ]);
    });

    it('keeps the previous cache when snapshot construction fails', () => {
      const existing = modelFixture({ provider: 'anthropic', id: 'existing' });
      const partial = modelFixture({ provider: 'openai', id: 'partial' });
      PI_AI_MODELS_CACHE.set('anthropic/existing', existing);
      const registry: PiModelRegistryProvider = {
        getProviders: () => [{ id: 'openai' }, { id: 'broken' }],
        getModels: (providerId) => {
          if (providerId === 'broken') {
            throw new Error('registry unavailable');
          }
          return [partial];
        },
      };

      expect(() => cachePiAiRegistryModels(registry)).toThrow('registry unavailable');
      expect([...PI_AI_MODELS_CACHE.entries()]).toEqual([
        ['anthropic/existing', existing],
      ]);
    });
  });

  describe('getPiAiModelsForProvider', () => {
    it('returns sorted picker options for models in the cache for that provider', () => {
      const zebra = modelFixture({
        provider: 'anthropic',
        id: 'z-model',
        name: 'Zebra',
        reasoning: true,
        contextWindow: 200_000,
      });
      const apple = modelFixture({
        provider: 'anthropic',
        id: 'a-model',
        name: 'Apple',
        reasoning: false,
        contextWindow: 1_000_000,
      });
      const otherProvider = modelFixture({ provider: 'openai', id: 'gpt', name: 'GPT' });
      PI_AI_MODELS_CACHE.set('anthropic/z-model', zebra);
      PI_AI_MODELS_CACHE.set('anthropic/a-model', apple);
      PI_AI_MODELS_CACHE.set('openai/gpt', otherProvider);

      const options = getPiAiModelsForProvider('anthropic');

      expect(options).toEqual([
        {
          value: 'anthropic/a-model',
          label: 'Apple',
          description: 'Standard model (context: 1M)',
        },
        {
          value: 'anthropic/z-model',
          label: 'Zebra',
          description: 'Reasoning model (context: 200K)',
        },
      ]);
    });

    it('returns an empty list when the provider has no cached models', () => {
      PI_AI_MODELS_CACHE.set('openai/gpt', modelFixture({ provider: 'openai', id: 'gpt', name: 'GPT' }));

      expect(getPiAiModelsForProvider('anthropic')).toEqual([]);
    });
  });

  describe('buildPiModelOptions', () => {
    it('maps cached visible models to labels, descriptions, and provider groups', () => {
      const cached = modelFixture({
        provider: 'anthropic',
        id: 'sonnet',
        name: 'Claude Sonnet',
        reasoning: true,
        contextWindow: 200_000,
      });
      PI_AI_MODELS_CACHE.set('anthropic/sonnet', cached);

      const options = buildPiModelOptions({ visibleModels: ['anthropic/sonnet'] });

      expect(options).toEqual([
        {
          value: 'anthropic/sonnet',
          label: 'Claude Sonnet',
          description: 'Reasoning model (context: 200K)',
          group: 'Anthropic',
          providerLogoSlug: 'anthropic',
          fallbackIcon: 'music',
        },
      ]);
    });

    it('omits visible models whose provider is disabled', () => {
      PI_AI_MODELS_CACHE.set(
        'anthropic/blocked',
        modelFixture({ provider: 'anthropic', id: 'blocked', name: 'Blocked' }),
      );
      PI_AI_MODELS_CACHE.set(
        'deepseek/allowed',
        modelFixture({ provider: 'deepseek', id: 'allowed', name: 'Allowed' }),
      );

      const options = buildPiModelOptions({
        visibleModels: ['anthropic/blocked', 'deepseek/allowed'],
        disabledProviders: ['anthropic'],
      });

      expect(options.map((o) => o.value)).toEqual(['deepseek/allowed']);
      expect(options[0]?.label).toBe('Allowed');
      expect(options[0]?.group).toBe('DeepSeek');
    });

    it('sorts provider groups by configured priority and models by label', () => {
      PI_AI_MODELS_CACHE.set(
        'anthropic/z-model',
        modelFixture({ provider: 'anthropic', id: 'z-model', name: 'Zebra' }),
      );
      PI_AI_MODELS_CACHE.set(
        'anthropic/a-model',
        modelFixture({ provider: 'anthropic', id: 'a-model', name: 'Apple' }),
      );
      PI_AI_MODELS_CACHE.set(
        'deepseek/chat',
        modelFixture({ provider: 'deepseek', id: 'chat', name: 'Chat' }),
      );

      const options = buildPiModelOptions({
        visibleModels: ['anthropic/z-model', 'deepseek/chat', 'anthropic/a-model'],
        addedProviders: ['deepseek', 'anthropic'],
      });

      expect(options.map((o) => [o.group, o.label])).toEqual([
        ['DeepSeek', 'Chat'],
        ['Anthropic', 'Apple'],
        ['Anthropic', 'Zebra'],
      ]);
    });

    it('falls back to the first cached model for an enabled added provider when visible list yields nothing', () => {
      PI_AI_MODELS_CACHE.set(
        'anthropic/other',
        modelFixture({ provider: 'anthropic', id: 'other', name: 'Other' }),
      );
      const deepseekModel = modelFixture({
        provider: 'deepseek',
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        reasoning: false,
        contextWindow: 64_000,
      });
      PI_AI_MODELS_CACHE.set('deepseek/deepseek-chat', deepseekModel);

      const options = buildPiModelOptions({
        visibleModels: ['anthropic/blocked-only'],
        disabledProviders: ['anthropic'],
        addedProviders: ['deepseek', 'anthropic'],
      });

      expect(options).toEqual([
        {
          value: 'deepseek/deepseek-chat',
          label: 'DeepSeek Chat',
          description: 'Standard model (context: 64K)',
          group: 'DeepSeek',
          providerLogoSlug: 'deepseek',
          fallbackIcon: 'search',
        },
      ]);
    });

    it('falls back to the first cached model when no added provider has a match', () => {
      const firstInserted = modelFixture({
        provider: 'openrouter',
        id: 'first',
        name: 'First Cached',
        contextWindow: 32_000,
      });
      PI_AI_MODELS_CACHE.set('openrouter/first', firstInserted);
      PI_AI_MODELS_CACHE.set(
        'anthropic/second',
        modelFixture({ provider: 'anthropic', id: 'second', name: 'Second' }),
      );

      const options = buildPiModelOptions({
        visibleModels: [],
        addedProviders: ['nonexistent-provider'],
      });

      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe('openrouter/first');
      expect(options[0]?.label).toBe('First Cached');
      expect(options[0]?.description).toBe('Standard model (context: 32K)');
    });

    it('returns the default DeepSeek option when the cache is empty and visible list is empty', () => {
      const options = buildPiModelOptions({ visibleModels: [] });

      expect(options).toEqual([
        {
          value: 'opencode-go/deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          description: 'Default model (no models in pool)',
          group: 'OpenCode Go',
          providerLogoSlug: 'opencode',
          fallbackIcon: 'search',
        },
      ]);
    });

    it('uses a custom default model key for the empty-cache fallback', () => {
      const options = buildPiModelOptions({
        visibleModels: [],
        defaultModelKey: 'custom/provider-model',
      });

      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe('custom/provider-model');
      expect(options[0]?.label).toBe('DeepSeek V4 Flash');
      expect(options[0]?.description).toBe('Default model (no models in pool)');
    });

    it('titleizes uncached visible model keys and uses the generic description', () => {
      const options = buildPiModelOptions({ visibleModels: ['custom/my-cool-model'] });

      expect(options).toEqual([
        {
          value: 'custom/my-cool-model',
          label: 'My Cool Model',
          description: 'Pi-supported model',
          group: 'Custom',
          providerLogoSlug: undefined,
          fallbackIcon: 'cpu',
        },
      ]);
    });
  });


  describe('resolvePiModelFromKeyWithLookup', () => {
    it('returns the cached model without calling lookup', () => {
      const cached = modelFixture({ provider: 'anthropic', id: 'cached', name: 'Cached' });
      PI_AI_MODELS_CACHE.set('anthropic/cached', cached);
      const lookup: PiModelLookup = {
        getModel: jest.fn(() => modelFixture({ provider: 'anthropic', id: 'other', name: 'Other' })),
      };

      const resolved = resolvePiModelFromKeyWithLookup('anthropic/cached', lookup);

      expect(resolved).toBe(cached);
      expect(lookup.getModel).not.toHaveBeenCalled();
    });

    it('resolves via lookup when the key is absent from the cache', () => {
      const fromLookup = modelFixture({ provider: 'anthropic', id: 'lookup-hit', name: 'Lookup Hit' });
      const lookup: PiModelLookup = {
        getModel: jest.fn((provider, modelId) =>
          provider === 'anthropic' && modelId === 'lookup-hit' ? fromLookup : null,
        ),
      };

      const resolved = resolvePiModelFromKeyWithLookup('anthropic/lookup-hit', lookup);

      expect(resolved).toBe(fromLookup);
      expect(lookup.getModel).toHaveBeenCalledWith('anthropic', 'lookup-hit');
    });

    it.each([
      ['no slash separator', 'anthropic-only'],
      ['slash at start', '/model-id'],
      ['empty key', ''],
    ])('returns null for invalid key: %s', (_label, modelKey) => {
      const lookup: PiModelLookup = { getModel: jest.fn(() => modelFixture({ provider: 'x', id: 'y' })) };

      expect(resolvePiModelFromKeyWithLookup(modelKey, lookup)).toBeNull();
      expect(lookup.getModel).not.toHaveBeenCalled();
    });

    it('returns null when lookup returns undefined', () => {
      const lookup: PiModelLookup = { getModel: () => undefined };

      expect(resolvePiModelFromKeyWithLookup('anthropic/missing', lookup)).toBeNull();
    });

    it('returns null when lookup throws', () => {
      const lookup: PiModelLookup = {
        getModel: () => {
          throw new Error('registry unavailable');
        },
      };

      expect(resolvePiModelFromKeyWithLookup('anthropic/broken', lookup)).toBeNull();
    });
  });
});
