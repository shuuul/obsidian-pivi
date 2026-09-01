import {
  createCustomProviderId,
  createDefaultCustomProviderConfig,
  modelsListUrl,
  MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS,
  normalizeCustomProviderConfig,
  normalizeCustomProviders,
  parseOpenAiStyleModelsList,
  reconcileVisibleModelsForCustomProviders,
} from '@pivi/agent/settings/customProviders';
import { getPiAiCredentialSecretId } from '@pivi/agent/auth/piProviderCredentials';
import { MAX_OBSIDIAN_SECRET_ID_LENGTH } from '@pivi/agent/auth/providerSecretStorage';
import {
  getPiAgentSettings,
  updatePiAgentSettings,
} from '@pivi/agent/settings/agentSettings';
import {
  buildCustomPiProvider,
  buildCustomProviderModels,
  fetchCustomProviderModels,
} from '@pivi/engine-pi/installPiCustomProviders';
import {
  configurePiAiModels,
  getInstalledCustomProviderIds,
  piAiModels,
  refreshCustomPiProviderModels,
  syncCustomPiProviders,
} from '@pivi/engine-pi/piAiModels';
import { PI_AI_MODELS_CACHE } from '@pivi/engine-pi/piModelRegistry';

describe('customProviders foundation', () => {
  it('creates fixed ids for local presets and collision-resistant ids for multi-instance kinds', () => {
    expect(createCustomProviderId('ollama', [])).toBe('ollama');
    const first = createCustomProviderId('openai-compatible', []);
    expect(first).toMatch(/^custom-openai-compatible-[0-9a-f]{12}$/);
    const second = createCustomProviderId('openai-compatible', [first]);
    expect(second).toMatch(/^custom-openai-compatible-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });

  it('keeps credential secret ids within Obsidian keychain limits', () => {
    for (const kind of MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS) {
      const providerId = createCustomProviderId(kind, []);
      expect(getPiAiCredentialSecretId(providerId).length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
    }
  });

  it('creates defaults for ollama', () => {
    const config = createDefaultCustomProviderConfig('ollama', []);
    expect(config).toMatchObject({
      id: 'ollama',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyRequired: false,
      models: [],
    });
  });

  it('treats private OpenAI-compatible URLs as keyless and public URLs as requiring a key', () => {
    expect(createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    }).apiKeyRequired).toBe(false);
    expect(createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'https://api.example.test/v1',
    }).apiKeyRequired).toBe(true);
    expect(createDefaultCustomProviderConfig('openai-compatible', []).apiKeyRequired).toBe(true);
  });

  it('recomputes apiKeyRequired from the URL even when a stale stored flag disagrees', () => {
    const config = normalizeCustomProviderConfig({
      id: 'custom-openai-compatible-abc',
      kind: 'openai-compatible',
      name: 'vLLM',
      baseUrl: 'http://192.168.100.177:8888/v1',
      api: 'openai-completions',
      apiKeyRequired: true,
      models: [],
    });
    expect(config?.apiKeyRequired).toBe(false);
  });

  it('preserves advertised reasoning metadata through config normalization', () => {
    const config = normalizeCustomProviderConfig({
      id: 'custom-openai-compatible-abc',
      kind: 'openai-compatible',
      name: 'vLLM',
      baseUrl: 'http://192.168.100.177:8888/v1',
      api: 'openai-completions',
      models: [{
        id: 'qwen38-nvfp4',
        name: 'qwen38-nvfp4',
        reasoning: true,
        reasoningMeta: {
          supportedEfforts: ['xhigh', 'medium', 'low'],
          defaultEffort: 'xhigh',
          defaultEnabled: true,
          mandatory: false,
        },
      }],
    });
    expect(config?.models).toEqual([expect.objectContaining({
      id: 'qwen38-nvfp4',
      reasoning: true,
      reasoningMeta: {
        supportedEfforts: ['xhigh', 'medium', 'low'],
        defaultEffort: 'xhigh',
        defaultEnabled: true,
        mandatory: false,
      },
    })]);
  });

  it('normalizes configs and drops invalid entries', () => {
    const configs = normalizeCustomProviders([
      {
        id: 'ollama',
        kind: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1/',
        api: 'openai-completions',
        models: [{ id: 'llama3', name: 'Llama 3' }],
      },
      { id: 'bad' },
      null,
    ]);
    expect(configs).toHaveLength(1);
    const [config] = configs;
    expect(config).toBeDefined();
    if (!config) throw new Error('Expected the normalized Ollama configuration');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    const [model] = config.models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the normalized Ollama model');
    expect(model.id).toBe('llama3');
  });

  it('builds models list URLs', () => {
    expect(modelsListUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/models');
    expect(modelsListUrl('http://localhost:11434/v1/models')).toBe(
      'http://localhost:11434/v1/models',
    );
  });

  it('parses OpenAI-style model list payloads', () => {
    const models = parseOpenAiStyleModelsList({
      data: [
        { id: 'a', name: 'A', context_window: 8192 },
        { id: 'b' },
      ],
    });
    expect(models.map((model) => model.id)).toEqual(['a', 'b']);
    const [model] = models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the first parsed model');
    expect(model.contextWindow).toBe(8192);
  });

  it('reads nested reasoning.supported_efforts from /v1/models cards', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{
        id: 'qwen38-nvfp4',
        max_model_len: 262144,
        max_tokens: 131072,
        max_output_tokens: 131072,
        reasoning: {
          supported_efforts: ['xhigh', 'medium', 'low'],
          default_effort: 'xhigh',
          default_enabled: true,
          mandatory: false,
        },
      }],
    });
    expect(models).toEqual([expect.objectContaining({
      id: 'qwen38-nvfp4',
      contextWindow: 262144,
      maxTokens: 131072,
      reasoning: true,
      reasoningMeta: {
        supportedEfforts: ['xhigh', 'medium', 'low'],
        defaultEffort: 'xhigh',
        defaultEnabled: true,
        mandatory: false,
      },
    })]);
  });

  it('prefers max_tokens over max_output_tokens for the advertised output ceiling', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{
        id: 'qwen38-nvfp4',
        max_tokens: 131072,
        max_output_tokens: 32768,
      }],
    });
    expect(models).toEqual([expect.objectContaining({
      id: 'qwen38-nvfp4',
      maxTokens: 131072,
    })]);
  });

  it('reads max_output_tokens when max_tokens is absent', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{ id: 'qwen38-nvfp4', max_output_tokens: 65536 }],
    });
    expect(models).toEqual([expect.objectContaining({
      id: 'qwen38-nvfp4',
      maxTokens: 65536,
    })]);
  });

  it('reads a top-level supported_reasoning_efforts array as reasoning metadata', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{
        id: 'legacy-card',
        supported_reasoning_efforts: ['low', 'medium', 'xhigh', 'xhigh', 'nope'],
      }],
    });
    expect(models).toEqual([expect.objectContaining({
      id: 'legacy-card',
      reasoning: true,
      reasoningMeta: { supportedEfforts: ['low', 'medium', 'xhigh'] },
    })]);
  });

  it('keeps models without advertised efforts as non-reasoning', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{ id: 'plain' }],
    });
    expect(models).toEqual([expect.objectContaining({
      id: 'plain',
    })]);
    expect(models[0]?.reasoning).toBeUndefined();
    expect(models[0]?.reasoningMeta).toBeUndefined();
  });

  it('ignores a reasoning object that has no supported_efforts', () => {
    const models = parseOpenAiStyleModelsList({
      data: [{
        id: 'empty-reasoning',
        reasoning: {
          default_effort: 'xhigh',
          default_enabled: true,
          mandatory: false,
        },
      }],
    });
    expect(models[0]?.reasoning).toBeUndefined();
    expect(models[0]?.reasoningMeta).toBeUndefined();
  });

  it('ignores empty or unknown supported_efforts values', () => {
    expect(parseOpenAiStyleModelsList({
      data: [{ id: 'empty-list', reasoning: { supported_efforts: [] } }],
    })[0]?.reasoningMeta).toBeUndefined();
    expect(parseOpenAiStyleModelsList({
      data: [{ id: 'unknown-only', reasoning: { supported_efforts: ['nope', 'maxx'] } }],
    })[0]?.reasoningMeta).toBeUndefined();
  });

  it('keeps a boolean reasoning flag when supported_efforts is absent', () => {
    const models = parseOpenAiStyleModelsList({
      data: [
        { id: 'flag-on', reasoning: true },
        { id: 'flag-off', reasoning: false },
      ],
    });
    expect(models.find((model) => model.id === 'flag-on')).toEqual(expect.objectContaining({
      id: 'flag-on',
      reasoning: true,
    }));
    expect(models.find((model) => model.id === 'flag-on')?.reasoningMeta).toBeUndefined();
    expect(models.find((model) => model.id === 'flag-off')?.reasoning).toBeUndefined();
    expect(models.find((model) => model.id === 'flag-off')?.reasoningMeta).toBeUndefined();
  });
});

describe('reconcileVisibleModelsForCustomProviders', () => {
  const providerId = 'custom-openai-compatible-5bbe1d19934e';
  const provider = {
    id: providerId,
    models: [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b' }],
  };

  it('replaces a stale checked key with the current config models', () => {
    expect(reconcileVisibleModelsForCustomProviders(
      [`${providerId}/deepseek-v4-flash-0731`],
      [provider],
    )).toEqual([`${providerId}/qwen3.8-27b`]);
  });

  it('keeps allowed keys and drops stale siblings without adding unchecked models', () => {
    expect(reconcileVisibleModelsForCustomProviders(
      [
        `${providerId}/qwen3.8-27b`,
        `${providerId}/deepseek-v4-flash-0731`,
      ],
      [{
        id: providerId,
        models: [
          { id: 'qwen3.8-27b', name: 'qwen3.8-27b' },
          { id: 'other', name: 'other' },
        ],
      }],
    )).toEqual([`${providerId}/qwen3.8-27b`]);
  });

  it('leaves an intentionally empty provider slice empty', () => {
    expect(reconcileVisibleModelsForCustomProviders(
      ['deepseek/deepseek-chat'],
      [provider],
    )).toEqual(['deepseek/deepseek-chat']);
  });
});

describe('custom providers in agent settings', () => {
  it('keeps custom provider ids in addedProviders and visible models', () => {
    const settings: Record<string, unknown> = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: ['ollama/llama3'],
        addedProviders: ['ollama'],
        customProviders: [
          createDefaultCustomProviderConfig('ollama', [], {
            baseUrl: 'http://localhost:11434/v1',
          }),
        ],
      },
    };

    // Seed models on the custom provider so they survive normalization.
    const seeded = createDefaultCustomProviderConfig('ollama', []);
    seeded.models = [{ id: 'llama3', name: 'Llama 3' }];
    updatePiAgentSettings(settings, {
      addedProviders: ['ollama'],
      customProviders: [seeded],
      visibleModels: ['ollama/llama3'],
    });

    const view = getPiAgentSettings(settings);
    expect(view.addedProviders).toContain('ollama');
    expect(view.customProviders).toHaveLength(1);
    expect(view.visibleModels).toEqual(['ollama/llama3']);
  });

  it('drops unknown custom providers when removed from customProviders', () => {
    const settings: Record<string, unknown> = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: ['custom-openai-compatible/gpt'],
        addedProviders: ['custom-openai-compatible'],
        customProviders: [],
      },
    };

    const view = getPiAgentSettings(settings);
    expect(view.addedProviders).toEqual([]);
    expect(view.visibleModels.length).toBeGreaterThan(0); // falls back to defaults
  });
});

describe('installPiCustomProviders model mapping', () => {
  it('maps stored models onto pi-ai model shapes', () => {
    const config = normalizeCustomProviderConfig({
      id: 'ollama',
      kind: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [{ id: 'llama3', name: 'Llama 3', contextWindow: 8192 }],
    });
    expect(config).not.toBeNull();
    const models = buildCustomProviderModels(config!);
    expect(models).toHaveLength(1);
    const [model] = models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the custom provider model');
    expect(model).toMatchObject({
      id: 'llama3',
      provider: 'ollama',
      api: 'openai-completions',
      baseUrl: 'http://localhost:11434/v1',
      contextWindow: 8192,
      contextWindowIsAuthoritative: true,
    });
  });

  it('applies explicit reasoning and wire-format overrides', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'https://gateway.example.test/v1',
    });
    config.models = [{
      id: 'glm-5.3-flash',
      name: 'GLM 5.3 Flash',
      reasoningOverride: true,
      thinkingFormatOverride: 'zai',
    }];

    const [model] = buildCustomProviderModels(config);

    expect(model).toMatchObject({
      reasoning: true,
      compat: expect.objectContaining({
        supportsReasoningEffort: true,
        thinkingFormat: 'zai',
      }),
    });
  });

  it('lets an explicit disabled override win over fetched reasoning metadata', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'https://gateway.example.test/v1',
    });
    config.models = [{
      id: 'reasoning-model',
      name: 'Reasoning model',
      reasoning: true,
      reasoningMeta: { supportedEfforts: ['low', 'high'] },
      reasoningOverride: false,
    }];

    const [model] = buildCustomProviderModels(config);

    expect(model?.reasoning).toBe(false);
    expect(model?.thinkingLevelMap).toBeUndefined();
    expect(model?.compat).toEqual(expect.objectContaining({ supportsReasoningEffort: false }));
  });

  it('overrides pi-ai thinking levels from advertised supported_efforts', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'qwen38-nvfp4',
      name: 'qwen38-nvfp4',
      reasoning: true,
      reasoningMeta: {
        supportedEfforts: ['xhigh', 'medium', 'low'],
        defaultEffort: 'xhigh',
        defaultEnabled: true,
        mandatory: false,
      },
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      id: 'qwen38-nvfp4',
      reasoning: true,
      defaultThinkingLevel: 'xhigh',
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: null,
        xhigh: 'xhigh',
        max: null,
      },
      compat: expect.objectContaining({
        supportsReasoningEffort: true,
        thinkingFormat: 'chat-template',
        chatTemplateKwargs: {
          enable_thinking: { $var: 'thinking.enabled' },
          reasoning_effort: { $var: 'thinking.effort', omitWhenOff: true },
          preserve_thinking: true,
        },
      }),
    });
  });

  it('keeps OpenAI-style reasoning_effort for non-Qwen custom openai-compatible models', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'deepseek-v4-flash-0731',
      name: 'DeepSeek V4 Flash 0731',
      reasoning: true,
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
    expect(model?.compat).not.toEqual(expect.objectContaining({
      thinkingFormat: 'chat-template',
    }));
  });

  it('uses advertised maxTokens as the request output cap instead of the 65536 default', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'qwen38-nvfp4',
      name: 'qwen38-nvfp4',
      contextWindow: 262144,
      maxTokens: 131072,
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      id: 'qwen38-nvfp4',
      contextWindow: 262144,
      contextWindowIsAuthoritative: true,
      maxTokens: 131072,
      outputTokenLimitIsAuthoritative: true,
    });
  });

  it('falls back to 65536 output tokens when a custom card omits maxTokens', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'qwen38-nvfp4',
      name: 'qwen38-nvfp4',
      contextWindow: 262144,
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      contextWindow: 262144,
      maxTokens: 65536,
      outputTokenLimitIsAuthoritative: false,
    });
  });

  it('uses a user-declared maxTokensOverride ahead of advertised maxTokens', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3.8-27b',
      name: 'qwen3.8-27b',
      contextWindow: 262144,
      maxTokens: 8192,
      maxTokensOverride: 262144,
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      contextWindow: 262144,
      maxTokens: 262144,
    });
  });

  it('clamps a user-declared maxTokensOverride to the context window', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3.8-27b',
      name: 'qwen3.8-27b',
      contextWindow: 262144,
      maxTokensOverride: 999999,
    }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      maxTokens: 262144,
    });
  });

  it('keeps pi-ai defaults when fetched models omit supported_efforts', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{ id: 'plain', name: 'plain' }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      id: 'plain',
      reasoning: false,
      compat: expect.objectContaining({ supportsReasoningEffort: false }),
    });
    expect(model?.thinkingLevelMap).toBeUndefined();
    expect((model as { defaultThinkingLevel?: string } | undefined)?.defaultThinkingLevel).toBeUndefined();
  });

  it('does not override thinking levels from a boolean reasoning flag alone', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{ id: 'flag-on', name: 'flag-on', reasoning: true }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      id: 'flag-on',
      reasoning: true,
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
    expect(model?.thinkingLevelMap).toBeUndefined();
    expect((model as { defaultThinkingLevel?: string } | undefined)?.defaultThinkingLevel).toBeUndefined();
  });

  it('inherits thinking levels from a matching built-in model id', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{ id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'deepseek-v4-flash-0731',
        reasoning: true,
        thinkingLevelMap: {
          minimal: null,
          low: null,
          medium: null,
          high: 'high',
          xhigh: null,
          max: 'max',
        },
      }],
    });

    expect(model).toMatchObject({
      id: 'deepseek-v4-flash-0731',
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: 'high',
        xhigh: null,
        max: 'max',
      },
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
  });

  it('inherits thinking levels from a family-stem catalog row when the exact id is absent', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b' }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'qwen3-235b-a22b',
        reasoning: true,
        thinkingLevelMap: {
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: null,
          max: null,
        },
      }],
    });

    expect(model).toMatchObject({
      id: 'qwen3.8-27b',
      reasoning: true,
      defaultThinkingLevel: 'xhigh',
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: null,
        xhigh: 'xhigh',
        max: null,
      },
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
  });

  it('uses the Qwen3.8 official thinking levels when no catalog row is present', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b' }];

    const [model] = buildCustomProviderModels(config);
    expect(model).toMatchObject({
      reasoning: true,
      defaultThinkingLevel: 'xhigh',
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: null,
        xhigh: 'xhigh',
        max: null,
      },
    });
  });

  it('prefers an exact catalog id over a family-stem row', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{ id: 'qwen3-32b', name: 'qwen3-32b' }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [
        {
          id: 'qwen3-235b-a22b',
          reasoning: true,
          thinkingLevelMap: { max: 'max' },
        },
        {
          id: 'qwen3-32b',
          reasoning: true,
          thinkingLevelMap: { high: 'high' },
        },
      ],
    });

    expect(model?.thinkingLevelMap).toEqual({ high: 'high' });
  });

  it('does not family-match a stem shorter than 5 characters', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{ id: 'gpt-4.1', name: 'gpt-4.1' }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'gpt-4o',
        reasoning: true,
        thinkingLevelMap: { medium: 'medium', high: 'high' },
      }],
    });

    expect(model?.thinkingLevelMap).toBeUndefined();
    expect(model?.reasoning).toBe(false);
  });

  it('inherits thinking levels when the custom id matches a provider-prefixed known id', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{ id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'deepseek/deepseek-v4-flash-0731',
        reasoning: true,
        thinkingLevelMap: { high: 'high', xhigh: 'xhigh', max: null },
      }],
    });

    expect(model?.thinkingLevelMap).toEqual({
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    });
    expect(model?.reasoning).toBe(true);
  });

  it('prefers advertised supported_efforts over a matching built-in model id', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'deepseek-v4-flash-0731',
      name: 'DeepSeek V4 Flash 0731',
      reasoning: true,
      reasoningMeta: {
        supportedEfforts: ['low', 'medium'],
        defaultEffort: 'low',
        defaultEnabled: true,
      },
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'deepseek-v4-flash-0731',
        reasoning: true,
        thinkingLevelMap: { high: 'high', max: 'max' },
        defaultThinkingLevel: 'high',
      }],
    });

    expect(model).toMatchObject({
      defaultThinkingLevel: 'low',
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: null,
        xhigh: null,
        max: null,
      },
    });
  });

  it('inherits thinking levels from a declared catalog model id', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3.8-27b',
      name: 'qwen3.8-27b',
      contextWindow: 262144,
      catalogModelId: 'qwen/qwen3.5-27b',
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'qwen/qwen3.5-27b',
        reasoning: true,
        thinkingLevelMap: { off: null, high: 'high', xhigh: 'xhigh' },
        defaultThinkingLevel: 'high',
      }],
    });

    expect(model).toMatchObject({
      id: 'qwen3.8-27b',
      reasoning: true,
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: null,
        xhigh: 'xhigh',
        max: null,
      },
      defaultThinkingLevel: 'xhigh',
      contextWindow: 262144,
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
  });

  it('inherits the reasoning flag from a catalog row without a thinking level map', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3-32b',
      name: 'qwen3-32b',
      catalogModelId: 'qwen/qwen3.5-27b',
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{ id: 'qwen/qwen3.5-27b', reasoning: true }],
    });

    expect(model?.reasoning).toBe(true);
    expect(model?.thinkingLevelMap).toBeUndefined();
    expect(model).toMatchObject({
      compat: expect.objectContaining({ supportsReasoningEffort: true }),
    });
  });

  it('matches a fully provider-qualified catalog id against bare known ids', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3.8-27b',
      name: 'qwen3.8-27b',
      catalogModelId: 'openrouter/qwen/qwen3.5-27b',
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{ id: 'qwen/qwen3.5-27b', reasoning: true }],
    });

    expect(model?.reasoning).toBe(true);
  });

  it('falls back to the server model id when the declared catalog id matches nothing', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    config.models = [{
      id: 'deepseek-v4-flash-0731',
      name: 'DeepSeek V4 Flash 0731',
      catalogModelId: 'qwen/qwen3.5-27b',
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'deepseek-v4-flash-0731',
        reasoning: true,
        thinkingLevelMap: { high: 'high' },
      }],
    });

    expect(model?.thinkingLevelMap).toEqual({ high: 'high' });
  });

  it('prefers advertised supported_efforts over a declared catalog model id', () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [{
      id: 'qwen3.8-27b',
      name: 'qwen3.8-27b',
      catalogModelId: 'qwen/qwen3.5-27b',
      reasoning: true,
      reasoningMeta: { supportedEfforts: ['low', 'medium'] },
    }];

    const [model] = buildCustomProviderModels(config, {
      knownModels: [{
        id: 'qwen/qwen3.5-27b',
        reasoning: true,
        thinkingLevelMap: { high: 'high', max: 'max' },
      }],
    });

    expect(model?.thinkingLevelMap).toEqual({
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: null,
      xhigh: null,
      max: null,
    });
  });

  it('uses a conservative context window for local models with unknown metadata', () => {
    const config = createDefaultCustomProviderConfig('ollama', []);
    config.models = [{ id: 'unknown', name: 'Unknown' }];

    const models = buildCustomProviderModels(config);
    const [model] = models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the local fallback model');
    expect(model).toMatchObject({
      contextWindow: 4096,
      contextWindowIsAuthoritative: false,
      maxTokens: 4096,
    });
  });

  it('keeps /v1 for Anthropic model discovery but removes it from runtime requests', async () => {
    const config = createDefaultCustomProviderConfig('anthropic-compatible', [], {
      baseUrl: 'https://anthropic.example.test/v1',
    });
    config.models = [{ id: 'claude-compatible', name: 'Claude compatible' }];
    const request = jest.fn(async () => ({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'claude-compatible' }] }),
    }));

    const [runtimeModel] = buildCustomProviderModels(config);
    await fetchCustomProviderModels(config, request);

    expect(runtimeModel?.baseUrl).toBe('https://anthropic.example.test');
    expect(config.baseUrl).toBe('https://anthropic.example.test/v1');
    expect(request).toHaveBeenCalledWith(
      'https://anthropic.example.test/v1/models',
      expect.any(Object),
    );
  });

  it('stores /v1/models reasoning.supported_efforts on fetched OpenAI-compatible models', async () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    const request = jest.fn(async () => ({
      status: 200,
      body: JSON.stringify({
        data: [{
          id: 'qwen38-nvfp4',
          max_model_len: 262144,
          max_tokens: 131072,
          max_output_tokens: 131072,
          reasoning: {
            supported_efforts: ['xhigh', 'medium', 'low'],
            default_effort: 'xhigh',
            default_enabled: true,
            mandatory: false,
          },
        }],
      }),
    }));

    const result = await fetchCustomProviderModels(config, request);
    expect(result.models).toEqual([expect.objectContaining({
      id: 'qwen38-nvfp4',
      contextWindow: 262144,
      maxTokens: 131072,
      reasoning: true,
      reasoningMeta: {
        supportedEfforts: ['xhigh', 'medium', 'low'],
        defaultEffort: 'xhigh',
        defaultEnabled: true,
        mandatory: false,
      },
    })]);
  });

  it('does not invent reasoning metadata when /v1/models omits the field', async () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    const request = jest.fn(async () => ({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'plain', max_model_len: 8192 }],
      }),
    }));

    const result = await fetchCustomProviderModels(config, request);
    expect(result.models).toEqual([expect.objectContaining({
      id: 'plain',
      contextWindow: 8192,
    })]);
    expect(result.models[0]?.reasoning).toBeUndefined();
    expect(result.models[0]?.reasoningMeta).toBeUndefined();
  });

  it('carries declared catalog model ids across a model-list fetch', async () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [
      { id: 'qwen3.8-27b', name: 'qwen3.8-27b', catalogModelId: 'qwen/qwen3.5-27b' },
      { id: 'retired', name: 'retired', catalogModelId: 'qwen/qwen3-32b' },
    ];
    const request = jest.fn(async () => ({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'qwen3.8-27b', max_model_len: 262144 }],
      }),
    }));

    const result = await fetchCustomProviderModels(config, request);

    expect(result.models).toEqual([expect.objectContaining({
      id: 'qwen3.8-27b',
      contextWindow: 262144,
      catalogModelId: 'qwen/qwen3.5-27b',
    })]);
  });

  it('carries a user-declared output-length override across a model-list fetch', async () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.114:8888/v1',
    });
    config.models = [
      {
        id: 'qwen3.8-27b',
        name: 'qwen3.8-27b',
        catalogModelId: 'qwen/qwen3.5-27b',
        maxTokensOverride: 262144,
      },
    ];
    const request = jest.fn(async () => ({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'qwen3.8-27b', max_model_len: 262144, max_tokens: 8192 }],
      }),
    }));

    const result = await fetchCustomProviderModels(config, request);

    expect(result.models).toEqual([expect.objectContaining({
      id: 'qwen3.8-27b',
      contextWindow: 262144,
      maxTokens: 8192,
      catalogModelId: 'qwen/qwen3.5-27b',
      maxTokensOverride: 262144,
    })]);
  });
});

describe('fetchCustomProviderModels local metadata', () => {
  it('uses Ollama num_ctx ahead of model architecture metadata', async () => {
    const request = jest.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return { status: 200, body: JSON.stringify({ models: [{ name: 'llama3' }] }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          parameters: 'temperature 0.8\nnum_ctx 8192',
          model_info: {
            'general.architecture': 'llama',
            'llama.context_length': 131072,
          },
        }),
      };
    });

    const result = await fetchCustomProviderModels(
      createDefaultCustomProviderConfig('ollama', []),
      request,
    );

    expect(result.models).toEqual([{ id: 'llama3', name: 'llama3', contextWindow: 8192 }]);
    expect(request).toHaveBeenLastCalledWith(
      'http://localhost:11434/api/show',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'llama3' }) }),
    );
  });

  it('derives Ollama native endpoints from a models-qualified base URL', async () => {
    const config = createDefaultCustomProviderConfig('ollama', [], {
      baseUrl: 'http://localhost:11434/v1/models',
    });
    const request = jest.fn(async (url: string) => url.endsWith('/api/tags')
      ? { status: 200, body: JSON.stringify({ models: [{ name: 'llama3' }] }) }
      : { status: 200, body: '{}' });

    await fetchCustomProviderModels(config, request);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/show',
    ]);
  });

  it('uses LM Studio loaded context ahead of the model maximum', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        models: [{
          type: 'llm',
          key: 'local-model',
          display_name: 'Local model',
          max_context_length: 131072,
          loaded_instances: [
            { config: { context_length: 16384 } },
            { config: { context_length: 4096 } },
          ],
        }],
      }),
    });

    const result = await fetchCustomProviderModels(
      createDefaultCustomProviderConfig('lmstudio', []),
      request,
    );

    const [model] = result.models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the LM Studio model');
    expect(model).toMatchObject({ id: 'local-model', contextWindow: 4096 });
    expect(request).toHaveBeenCalledWith(
      'http://localhost:1234/api/v1/models',
      expect.any(Object),
    );
  });

  it('uses llama.cpp runtime props ahead of training metadata', async () => {
    const request = jest.fn(async (url: string) => url.endsWith('/props')
      ? {
          status: 200,
          body: JSON.stringify({ default_generation_settings: { n_ctx: 32768 } }),
        }
      : {
          status: 200,
          body: JSON.stringify({
            data: [{ id: 'model.gguf', meta: { n_ctx_train: 131072 } }],
          }),
        });

    const result = await fetchCustomProviderModels(
      createDefaultCustomProviderConfig('llama-cpp', []),
      request,
    );

    const [model] = result.models;
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the llama.cpp model');
    expect(model).toMatchObject({ id: 'model.gguf', contextWindow: 32768 });
  });
});

describe('pi-ai custom provider runtime state', () => {
  afterEach(() => {
    configurePiAiModels({});
    PI_AI_MODELS_CACHE.clear();
  });

  it('clears installed provider tracking during reconfiguration', () => {
    syncCustomPiProviders([createDefaultCustomProviderConfig('ollama', [])]);
    expect(getInstalledCustomProviderIds()).toEqual(['ollama']);

    configurePiAiModels({});

    expect(getInstalledCustomProviderIds()).toEqual([]);
  });

  it('refreshes a configured provider and replaces its runtime model metadata', async () => {
    const config = createDefaultCustomProviderConfig('lmstudio', []);
    config.models = [{ id: 'local-model', name: 'Local model', contextWindow: 131072 }];
    configurePiAiModels({
      customProviders: [config],
      httpGet: async () => ({
        status: 200,
        body: JSON.stringify({
          models: [{
            type: 'llm',
            key: 'local-model',
            loaded_instances: [{ config: { context_length: 8192 } }],
          }],
        }),
      }),
    });

    await expect(refreshCustomPiProviderModels('lmstudio')).resolves.toBe(true);

    const provider = piAiModels.getProvider('lmstudio');
    expect(provider).toBeDefined();
    if (!provider) throw new Error('Expected the configured LM Studio provider');
    const [model] = provider.getModels();
    expect(model).toBeDefined();
    if (!model) throw new Error('Expected the refreshed LM Studio model');
    expect(model).toMatchObject({
      id: 'local-model',
      contextWindow: 8192,
    });
  });

  it('removes cached models when a custom provider is removed', () => {
    const config = createDefaultCustomProviderConfig('ollama', []);
    config.models = [{ id: 'llama3', name: 'Llama 3' }];
    configurePiAiModels({ customProviders: [config] });
    expect(PI_AI_MODELS_CACHE.has('ollama/llama3')).toBe(true);

    syncCustomPiProviders([]);

    expect(piAiModels.getProvider('ollama')).toBeUndefined();
    expect(PI_AI_MODELS_CACHE.has('ollama/llama3')).toBe(false);
  });

  it('removes cached models omitted by a provider refresh', async () => {
    const config = createDefaultCustomProviderConfig('lmstudio', []);
    config.models = [
      { id: 'kept', name: 'Kept' },
      { id: 'removed', name: 'Removed' },
    ];
    configurePiAiModels({
      customProviders: [config],
      httpGet: async () => ({
        status: 200,
        body: JSON.stringify({
          models: [{ type: 'llm', key: 'kept' }],
        }),
      }),
    });

    await refreshCustomPiProviderModels('lmstudio');

    expect(PI_AI_MODELS_CACHE.has('lmstudio/kept')).toBe(true);
    expect(PI_AI_MODELS_CACHE.has('lmstudio/removed')).toBe(false);
  });

  it('drops custom model cache entries during full reconfiguration', () => {
    const config = createDefaultCustomProviderConfig('ollama', []);
    config.models = [{ id: 'llama3', name: 'Llama 3' }];
    configurePiAiModels({ customProviders: [config] });
    expect(PI_AI_MODELS_CACHE.has('ollama/llama3')).toBe(true);

    configurePiAiModels({});

    expect(PI_AI_MODELS_CACHE.has('ollama/llama3')).toBe(false);
  });
});

describe('buildCustomPiProvider keyless auth', () => {
  it('resolves a non-empty api key placeholder for local providers without credentials', async () => {
    const config = createDefaultCustomProviderConfig('lmstudio', []);
    const provider = buildCustomPiProvider(config);
    const resolved = await provider.auth.apiKey?.resolve({
      model: {
        id: 'local-model',
        name: 'Local',
        provider: 'lmstudio',
        api: 'openai-completions',
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
      ctx: { env: async () => undefined, fileExists: async () => false },
      credential: undefined,
    } as any);

    expect(resolved?.source).toBe('keyless');
    expect(resolved?.auth.apiKey).toBeTruthy();
  });

  it('resolves keyless auth for a private OpenAI-compatible endpoint', async () => {
    const config = createDefaultCustomProviderConfig('openai-compatible', [], {
      baseUrl: 'http://192.168.100.177:8888/v1',
    });
    const provider = buildCustomPiProvider(config);
    const resolved = await provider.auth.apiKey?.resolve({
      model: {
        id: 'qwen',
        name: 'Qwen',
        provider: config.id,
        api: 'openai-completions',
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
      ctx: { env: async () => undefined, fileExists: async () => false },
      credential: undefined,
    } as any);

    expect(config.apiKeyRequired).toBe(false);
    expect(resolved?.source).toBe('keyless');
    expect(resolved?.auth.apiKey).toBeTruthy();
  });
});
