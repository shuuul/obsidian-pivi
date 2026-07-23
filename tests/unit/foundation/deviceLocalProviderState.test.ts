import {
  DEFAULT_MODEL_KEY,
  DEFAULT_PI_PROVIDER_IDS,
  DEFAULT_PIVI_SETTINGS,
} from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import {
  type PiviSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import {
  extractDeviceLocalProviderState,
  normalizeDeviceLocalProviderState,
  projectProviderState,
  seedDefaultDeviceLocalProviderState,
  stripLocalizedFieldsFromRuntimeSettings,
} from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';

function runtimeSettings(overrides: Partial<PiviSettings> = {}): PiviSettings {
  return {
    ...DEFAULT_PIVI_SETTINGS,
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      ...(overrides.agentSettings ?? {}),
    },
    ...overrides,
  };
}

describe('seedDefaultDeviceLocalProviderState', () => {
  it('seeds deepseek-only defaults with initialized local state', () => {
    const state = seedDefaultDeviceLocalProviderState();

    expect(state.version).toBe(1);
    expect(state.initialized).toBe(true);
    expect(state.providers).toEqual([
      { id: 'deepseek', type: 'builtin', disabled: false },
    ]);
    expect(state.modelPreferences.visibleModels).toEqual([DEFAULT_MODEL_KEY]);
    expect(state.modelPreferences.activeModel).toBe(DEFAULT_MODEL_KEY);
    expect(state.modelPreferences.titleGenerationModel).toBe('');
    expect(DEFAULT_PI_PROVIDER_IDS).toEqual(['deepseek']);
    expect(DEFAULT_MODEL_KEY).toBe('deepseek/deepseek-chat');
  });
});

describe('normalizeDeviceLocalProviderState', () => {
  it('deduplicates providers and enforces custom config id alignment', () => {
    const state = normalizeDeviceLocalProviderState({
      version: 1,
      initialized: true,
      providers: [
        { id: 'deepseek', type: 'builtin', disabled: false },
        { id: 'deepseek', type: 'builtin', disabled: true },
        {
          id: 'custom-openai-compatible',
          type: 'custom',
          disabled: false,
          config: {
            id: 'custom-openai-compatible',
            kind: 'openai-compatible',
            name: 'Local OpenAI',
            baseUrl: 'http://localhost:8080/v1',
            api: 'openai-completions',
            models: [{ id: 'local-model', name: 'Local model' }],
            headers: { Authorization: 'secret' },
          },
        },
      ],
      modelPreferences: {
        visibleModels: [
          'deepseek/deepseek-chat',
          'deepseek/deepseek-chat',
          'disabled/model',
        ],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: 'deepseek/deepseek-chat',
        customContextLimits: {
          'custom-openai-compatible/local-model': 32000,
          'anthropic/claude-3': 200000,
        },
      },
      webSearchTools: {
        providerOrder: ['brave', 'brave', 'tavily', 'bogus'],
        disabledProviders: ['tavily', 'exa'],
      fetchMode: 'direct-only',
      },
    });

    expect(state.providers).toHaveLength(2);
    expect(state.providers[0]).toEqual({
      id: 'deepseek',
      type: 'builtin',
      disabled: false,
    });
    const customProvider = state.providers[1];
    expect(customProvider?.type).toBe('custom');
    expect(customProvider).toMatchObject({
      type: 'custom',
      config: expect.not.objectContaining({ headers: expect.anything() }),
    });
    expect(state.modelPreferences.visibleModels).toEqual(['deepseek/deepseek-chat']);
    expect(state.modelPreferences.customContextLimits).toEqual({
      'custom-openai-compatible/local-model': 32000,
    });
    expect(state.webSearchTools).toEqual({
      providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
      disabledProviders: ['tavily', 'exa'],
      fetchMode: 'direct-only',
    });
  });

  it('clears invalid title, last, and active model references', () => {
    const state = normalizeDeviceLocalProviderState({
      version: 1,
      initialized: true,
      providers: [
        { id: 'deepseek', type: 'builtin', disabled: true },
      ],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: 'deepseek/deepseek-chat',
        lastModel: 'deepseek/deepseek-chat',
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      fetchMode: 'direct-only',
      },
    });

    expect(state.modelPreferences.visibleModels).toEqual([]);
    expect(state.modelPreferences.activeModel).toBe('');
    expect(state.modelPreferences.titleGenerationModel).toBe('');
    expect(state.modelPreferences.lastModel).toBeUndefined();
  });

  it('returns defensive copies that isolate mutation', () => {
    const state = seedDefaultDeviceLocalProviderState();
    state.providers.push({
      id: 'anthropic',
      type: 'builtin',
      disabled: false,
    });
    state.modelPreferences.visibleModels.push('anthropic/claude-3');
    state.webSearchTools.providerOrder.push('bogus' as never);

    const normalized = normalizeDeviceLocalProviderState(state);
    normalized.providers[0]!.disabled = true;
    normalized.modelPreferences.visibleModels.push('openai/gpt-4.1');
    normalized.webSearchTools.providerOrder.push('bogus' as never);

    const reloaded = seedDefaultDeviceLocalProviderState();
    expect(reloaded.providers).toEqual([
      { id: 'deepseek', type: 'builtin', disabled: false },
    ]);
    expect(reloaded.modelPreferences.visibleModels).toEqual([DEFAULT_MODEL_KEY]);
    expect(reloaded.webSearchTools.providerOrder).not.toContain('bogus');
  });
});

describe('projectProviderState', () => {
  it('projects local registrations into runtime provider fields', () => {
    const projected = projectProviderState(normalizeDeviceLocalProviderState({
      version: 1,
      initialized: true,
      providers: [
        { id: 'deepseek', type: 'builtin', disabled: false },
        {
          id: 'custom-openai-compatible',
          type: 'custom',
          disabled: true,
          config: {
            id: 'custom-openai-compatible',
            kind: 'openai-compatible',
            name: 'Local OpenAI',
            baseUrl: 'http://localhost:8080/v1',
            api: 'openai-completions',
            models: [],
          },
        },
      ],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      fetchMode: 'direct-only',
      },
    }));

    expect(projected.addedProviders).toEqual(['deepseek', 'custom-openai-compatible']);
    expect(projected.disabledProviders).toEqual(['custom-openai-compatible']);
    expect(projected.customProviders).toEqual([
      expect.objectContaining({ id: 'custom-openai-compatible' }),
    ]);
    expect(projected.visibleModels).toEqual(['deepseek/deepseek-chat']);
    projected.visibleModels.push('anthropic/claude-3');
    expect(projectProviderState(seedDefaultDeviceLocalProviderState()).visibleModels)
      .toEqual([DEFAULT_MODEL_KEY]);
  });
});

describe('extractDeviceLocalProviderState', () => {
  it('extracts runtime provider and model preferences without headers', () => {
    const settings = runtimeSettings({
      model: 'deepseek/deepseek-chat',
      titleGenerationModel: 'deepseek/deepseek-chat',
      customContextLimits: {
        'deepseek/deepseek-chat': 64000,
        'custom-openai-compatible/local-model': 32000,
      },
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        addedProviders: ['deepseek', 'custom-openai-compatible'],
        disabledProviders: ['custom-openai-compatible'],
        visibleModels: ['deepseek/deepseek-chat'],
        lastModel: 'deepseek/deepseek-chat',
        customProviders: [{
          id: 'custom-openai-compatible',
          kind: 'openai-compatible',
          name: 'Local OpenAI',
          baseUrl: 'http://localhost:8080/v1',
          api: 'openai-completions',
          models: [{ id: 'local-model', name: 'Local model' }],
          headers: { Authorization: 'secret' },
        }],
        webSearchTools: {
          providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
          disabledProviders: ['exa'],
      fetchMode: 'direct-only',
        },
      },
    });

    const extracted = extractDeviceLocalProviderState(settings);
    expect(extracted.providers).toEqual([
      { id: 'deepseek', type: 'builtin', disabled: false },
      {
        id: 'custom-openai-compatible',
        type: 'custom',
        disabled: true,
        config: expect.objectContaining({
          id: 'custom-openai-compatible',
        }),
      },
    ]);
    const customProvider = extracted.providers[1];
    expect(customProvider).toMatchObject({
      type: 'custom',
      config: expect.not.objectContaining({ headers: expect.anything() }),
    });
    expect(extracted.modelPreferences.customContextLimits).toEqual({
      'custom-openai-compatible/local-model': 32000,
    });
    expect(extracted.webSearchTools.disabledProviders).toEqual(['exa']);
  });
});

describe('stripLocalizedFieldsFromRuntimeSettings', () => {
  it('removes provider, model, webSearchTools, and custom-provider context limits', () => {
    const settings = runtimeSettings({
      model: 'deepseek/deepseek-chat',
      titleGenerationModel: 'deepseek/deepseek-chat',
      customContextLimits: {
        'deepseek/deepseek-chat': 64000,
        'custom-openai-compatible/local-model': 32000,
      },
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        addedProviders: ['deepseek', 'custom-openai-compatible'],
        disabledProviders: ['custom-openai-compatible'],
        visibleModels: ['deepseek/deepseek-chat'],
        lastModel: 'deepseek/deepseek-chat',
        customProviders: [{
          id: 'custom-openai-compatible',
          kind: 'openai-compatible',
          name: 'Local OpenAI',
          baseUrl: 'http://localhost:8080/v1',
          api: 'openai-completions',
          models: [],
        }],
        webSearchTools: {
          providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
          disabledProviders: ['exa'],
      fetchMode: 'direct-only',
        },
      },
    });

    const stripped = stripLocalizedFieldsFromRuntimeSettings(settings);
    expect(stripped).not.toHaveProperty('model');
    expect(stripped).not.toHaveProperty('titleGenerationModel');
    expect(stripped.customContextLimits).toEqual({
      'deepseek/deepseek-chat': 64000,
    });
    expect(stripped.agentSettings).not.toHaveProperty('addedProviders');
    expect(stripped.agentSettings).not.toHaveProperty('disabledProviders');
    expect(stripped.agentSettings).not.toHaveProperty('customProviders');
    expect(stripped.agentSettings).not.toHaveProperty('visibleModels');
    expect(stripped.agentSettings).not.toHaveProperty('lastModel');
    expect(stripped.agentSettings).not.toHaveProperty('webSearchTools');
    expect(stripped.agentSettings).not.toHaveProperty('environmentVariables');
    expect(stripped).not.toHaveProperty('sharedEnvironmentVariables');
  });
});
