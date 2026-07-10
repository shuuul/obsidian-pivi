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
} from '@pivi/pivi-agent-core/engine/pi/customProviders';
import {
  configurePiAiModels,
  getInstalledCustomProviderIds,
  piAiModels,
  refreshCustomPiProviderModels,
  syncCustomPiProviders,
} from '@pivi/pivi-agent-core/engine/pi/piAiModels';

describe('customProviders foundation', () => {
  it('creates fixed ids for local presets and unique ids for multi-instance kinds', () => {
    expect(createCustomProviderId('ollama', [])).toBe('ollama');
    expect(createCustomProviderId('openai-compatible', [])).toBe('custom-openai-compatible');
    expect(createCustomProviderId('openai-compatible', ['custom-openai-compatible'])).toBe(
      'custom-openai-compatible-2',
    );
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
    expect(configs[0].baseUrl).toBe('http://localhost:11434/v1');
    expect(configs[0].models[0].id).toBe('llama3');
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
    expect(models[0].contextWindow).toBe(8192);
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

describe('buildCustomProviderModels', () => {
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
    expect(models[0]).toMatchObject({
      id: 'llama3',
      provider: 'ollama',
      api: 'openai-completions',
      baseUrl: 'http://localhost:11434/v1',
      contextWindow: 8192,
    });
  });

  it('uses a conservative context window for local models with unknown metadata', () => {
    const config = createDefaultCustomProviderConfig('ollama', []);
    config.models = [{ id: 'unknown', name: 'Unknown' }];

    expect(buildCustomProviderModels(config)[0]).toMatchObject({
      contextWindow: 4096,
      maxTokens: 4096,
    });
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

    expect(result.models[0]).toMatchObject({ id: 'local-model', contextWindow: 4096 });
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

    expect(result.models[0]).toMatchObject({ id: 'model.gguf', contextWindow: 32768 });
  });
});

describe('pi-ai custom provider runtime state', () => {
  afterEach(() => configurePiAiModels({}));

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

    expect(piAiModels.getProvider('lmstudio')?.getModels()[0]).toMatchObject({
      id: 'local-model',
      contextWindow: 8192,
    });
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
