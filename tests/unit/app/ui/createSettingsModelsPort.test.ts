import type { ChatUIOption } from '@pivi/agent/runtime/chatUi';
import type { CustomProviderConfig } from '@pivi/agent/settings/customProviders';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/agent/settings/defaults';

import type { PiviPluginWorkspace, PiviSettingsHost, PiviUiFacades } from '@/app/hostContracts';
import { createSettingsModelsPort } from '@/app/ui/createSettingsModelsPort';

function createHarness() {
  const settings = {
    ...DEFAULT_PIVI_SETTINGS,
    model: 'anthropic/claude-test',
    titleGenerationModel: 'anthropic/claude-test',
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      addedProviders: ['anthropic', 'deepseek'],
      disabledProviders: ['anthropic'],
      visibleModels: ['anthropic/claude-test'],
      customProviders: [] as CustomProviderConfig[],
    },
  };
  const saveSettings = jest.fn(async () => undefined);
  const refreshModelPresentation = jest.fn();
  const deleteCredential = jest.fn(async () => undefined);
  const deepseekModel: ChatUIOption = {
    value: 'deepseek/deepseek-chat',
    label: 'DeepSeek Chat',
  };
  const host = {
    app: { secretStorage: undefined },
    settings,
    saveSettings,
    getAllViews: () => [{
      getChatHandle: () => ({ maintenance: { refreshModelPresentation } }),
    }],
  } as unknown as PiviSettingsHost;
  const uiFacades = {
    listModelsForProvider: (providerId: string) => providerId === 'deepseek' ? [deepseekModel] : [],
    syncCustomProviders: jest.fn(),
    getSettingsSnapshot: <T extends Record<string, unknown>>(value: T) => ({ ...value }),
    commitSettingsSnapshot: (target: Record<string, unknown>, snapshot: Record<string, unknown>) => {
      Object.assign(target, snapshot);
    },
  } as unknown as PiviUiFacades;
  const workspace = {
    credentialStore: {
      readSync: () => undefined,
      modify: async () => undefined,
      delete: deleteCredential,
    },
  } as unknown as PiviPluginWorkspace;

  return {
    deleteCredential,
    host,
    port: createSettingsModelsPort(host, uiFacades, workspace),
    refreshModelPresentation,
    saveSettings,
    settings,
    uiFacades,
  };
}

describe('createSettingsModelsPort provider removal', () => {
  it('keeps in-memory provider order when synced save fails after local commit', async () => {
    const harness = createHarness();
    harness.saveSettings.mockRejectedValueOnce(new Error('save failed'));

    await expect(harness.port.saveSettings({
      addedProviders: ['deepseek', 'anthropic'],
    })).rejects.toThrow('save failed');

    expect(harness.settings.agentSettings.addedProviders).toEqual(['deepseek', 'anthropic']);
    expect(harness.refreshModelPresentation).not.toHaveBeenCalled();
  });

  it('adds built-in providers disabled until they are ready', async () => {
    const harness = createHarness();

    await harness.port.addBuiltinProvider('openai');

    expect(harness.settings.agentSettings.addedProviders).toContain('openai');
    expect(harness.settings.agentSettings.disabledProviders).toContain('openai');
  });

  it('adds custom providers disabled until they are ready', async () => {
    const harness = createHarness();

    const providerId = await harness.port.addCustomKind('openai-compatible');

    expect(harness.settings.agentSettings.addedProviders).toContain(providerId);
    expect(harness.settings.agentSettings.disabledProviders).toContain(providerId);
  });

  it('reports configuration readiness independently from disabled state', () => {
    const harness = createHarness();
    harness.settings.agentSettings.disabledProviders = ['deepseek'];
    harness.settings.agentSettings.environmentVariables = 'DEEPSEEK_API_KEY=test';

    expect(harness.port.getReadiness('deepseek')).toBe('ready');
  });

  it('cleans provider settings and reconciles active and title models', async () => {
    const harness = createHarness();

    await harness.port.removeProvider('anthropic', false);

    expect(harness.settings.agentSettings).toMatchObject({
      addedProviders: ['deepseek'],
      disabledProviders: [],
      visibleModels: ['deepseek/deepseek-chat'],
      customProviders: [],
    });
    expect(harness.settings.model).toBe('deepseek/deepseek-chat');
    expect(harness.settings.titleGenerationModel).toBe('');
    expect(harness.deleteCredential).not.toHaveBeenCalled();
    expect(harness.saveSettings).toHaveBeenCalledTimes(1);
    expect(harness.refreshModelPresentation).toHaveBeenCalledTimes(1);
  });

  it('refreshes open chat model pickers after a custom provider display-name change', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.addedProviders = ['custom-openai-compatible-lan'];
    harness.settings.agentSettings.customProviders = [{
      id: 'custom-openai-compatible-lan',
      kind: 'openai-compatible',
      name: 'OpenAI compatible',
      baseUrl: 'http://192.168.100.177:8888/v1',
      api: 'openai-completions',
      models: [],
    }];

    await harness.port.patchCustomProvider('custom-openai-compatible-lan', { name: 'Home vLLM' });

    expect(harness.settings.agentSettings.customProviders[0]?.name).toBe('Home vLLM');
    expect(harness.refreshModelPresentation).toHaveBeenCalledTimes(1);
  });

  it('sets and clears a custom model catalog id through the settings port', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.addedProviders = ['custom-openai-compatible-lan'];
    harness.settings.agentSettings.customProviders = [{
      id: 'custom-openai-compatible-lan',
      kind: 'openai-compatible',
      name: 'DGX Spark',
      baseUrl: 'http://192.168.100.114:8888/v1',
      api: 'openai-completions',
      models: [
        { id: 'qwen3.8-27b', name: 'qwen3.8-27b', contextWindow: 262144 },
        { id: 'other', name: 'other' },
      ],
    }];

    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'qwen3.8-27b',
      { catalogModelId: ' qwen/qwen3.5-27b ' },
    );

    let models = harness.settings.agentSettings.customProviders[0]?.models;
    expect(models?.[0]?.catalogModelId).toBe('qwen/qwen3.5-27b');
    expect(models?.[1]?.catalogModelId).toBeUndefined();
    expect(harness.uiFacades.syncCustomProviders).toHaveBeenCalled();
    expect(harness.saveSettings).toHaveBeenCalledTimes(1);
    expect(harness.refreshModelPresentation).toHaveBeenCalledTimes(1);

    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'qwen3.8-27b',
      { catalogModelId: '' },
    );

    models = harness.settings.agentSettings.customProviders[0]?.models;
    expect(models?.[0]?.catalogModelId).toBeUndefined();
  });

  it('sets and clears a custom model output-length override without dropping catalog id', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.addedProviders = ['custom-openai-compatible-lan'];
    harness.settings.agentSettings.customProviders = [{
      id: 'custom-openai-compatible-lan',
      kind: 'openai-compatible',
      name: 'DGX Spark',
      baseUrl: 'http://192.168.100.114:8888/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'qwen3.8-27b',
          name: 'qwen3.8-27b',
          contextWindow: 262144,
          catalogModelId: 'qwen/qwen3.5-27b',
        },
      ],
    }];

    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'qwen3.8-27b',
      { maxTokensOverride: 262144 },
    );

    let models = harness.settings.agentSettings.customProviders[0]?.models;
    expect(models?.[0]?.catalogModelId).toBe('qwen/qwen3.5-27b');
    expect(models?.[0]?.maxTokensOverride).toBe(262144);

    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'qwen3.8-27b',
      { maxTokensOverride: null },
    );

    models = harness.settings.agentSettings.customProviders[0]?.models;
    expect(models?.[0]?.catalogModelId).toBe('qwen/qwen3.5-27b');
    expect(models?.[0]?.maxTokensOverride).toBeUndefined();
  });

  it('sets and clears context, reasoning, and thinking-format overrides', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.customProviders = [{
      id: 'custom-openai-compatible-lan',
      kind: 'openai-compatible',
      name: 'Campus gateway',
      baseUrl: 'https://gateway.example.test/v1',
      api: 'openai-completions',
      models: [{ id: 'glm-5.3-flash', name: 'GLM 5.3 Flash' }],
    }];
    const modelKey = 'custom-openai-compatible-lan/glm-5.3-flash';

    await harness.port.patchContextWindowOverride(modelKey, 262_144);
    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'glm-5.3-flash',
      { reasoningOverride: true, thinkingFormatOverride: 'zai' },
    );

    expect(harness.port.getContextWindowOverride(modelKey)).toBe(262_144);
    expect(harness.settings.agentSettings.customProviders[0]?.models[0]).toMatchObject({
      reasoningOverride: true,
      thinkingFormatOverride: 'zai',
    });

    await harness.port.patchContextWindowOverride(modelKey, null);
    await harness.port.patchCustomProviderModel(
      'custom-openai-compatible-lan',
      'glm-5.3-flash',
      { reasoningOverride: null, thinkingFormatOverride: null },
    );

    expect(harness.port.getContextWindowOverride(modelKey)).toBeNull();
    expect(harness.settings.agentSettings.customProviders[0]?.models[0]?.reasoningOverride)
      .toBeUndefined();
    expect(harness.settings.agentSettings.customProviders[0]?.models[0]?.thinkingFormatOverride)
      .toBeUndefined();
  });

  it('deletes the provider credential only when explicitly requested', async () => {
    const harness = createHarness();

    await harness.port.removeProvider('anthropic', true);

    expect(harness.deleteCredential).toHaveBeenCalledWith('anthropic');
  });

  it('does not select a disabled provider as the active fallback', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.disabledProviders = ['anthropic', 'deepseek'];

    await harness.port.removeProvider('anthropic', false);

    expect(harness.settings.agentSettings.disabledProviders).toEqual(['deepseek']);
    expect(harness.settings.model).toBe('');
    expect(harness.settings.titleGenerationModel).toBe('');
  });

  it('fails before removing settings when requested credential storage is unavailable', async () => {
    const harness = createHarness();
    const workspaceWithoutCredentials = {} as PiviPluginWorkspace;
    const port = createSettingsModelsPort(
      harness.host,
      harness.uiFacades,
      workspaceWithoutCredentials,
    );

    await expect(port.removeProvider('anthropic', true)).rejects.toThrow(
      'Provider credential storage is unavailable.',
    );
    expect(harness.settings.agentSettings.addedProviders).toContain('anthropic');
  });
});
