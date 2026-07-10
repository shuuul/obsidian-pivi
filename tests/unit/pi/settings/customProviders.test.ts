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
} from '@pivi/pivi-agent-core/engine/pi/customProviders';

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
