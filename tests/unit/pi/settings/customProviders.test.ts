import {
  createCustomProviderId,
  createDefaultCustomProviderConfig,
  modelsListUrl,
  normalizeCustomProviderConfig,
  normalizeCustomProviders,
  parseOpenAiStyleModelsList,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import {
  getPiAgentSettings,
  updatePiAgentSettings,
} from '@pivi/pivi-agent-core/foundation/agentSettings';
import {
  buildCustomPiProvider,
  buildCustomProviderModels,
  fetchCustomProviderModels,
} from '@pivi/pivi-agent-core/engine/pi/installPiCustomProviders';
import {
  configurePiAiModels,
  getInstalledCustomProviderIds,
  piAiModels,
  refreshCustomPiProviderModels,
  syncCustomPiProviders,
} from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { PI_AI_MODELS_CACHE } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';

describe('customProviders foundation', () => {
  it('creates fixed ids for local presets and collision-resistant ids for multi-instance kinds', () => {
    expect(createCustomProviderId('ollama', [])).toBe('ollama');
    const first = createCustomProviderId('openai-compatible', []);
    expect(first).toMatch(/^custom-openai-compatible-[0-9a-f-]{36}$/);
    const second = createCustomProviderId('openai-compatible', [first]);
    expect(second).toMatch(/^custom-openai-compatible-[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
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
});
