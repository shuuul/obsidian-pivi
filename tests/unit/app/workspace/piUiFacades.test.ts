import {
  getPiAgentSettings,
  updatePiAgentSettings,
} from '@pivi/agent/foundation/agentSettings';
import {
  type CustomProviderConfig,
  createDefaultCustomProviderConfig,
} from '@pivi/agent/foundation/customProviders';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/agent/foundation/settingsDefaults';
import { fetchCustomProviderModels } from '@pivi/engine-pi/installPiCustomProviders';
import { syncCustomPiProviders } from '@pivi/engine-pi/piAiModels';

import { createPiUiFacades } from '@/app/workspace/piUiFacades';

jest.mock('@pivi/engine-pi/installPiCustomProviders', () => ({
  fetchCustomProviderModels: jest.fn(),
}));
jest.mock('@pivi/engine-pi/piAiModels', () => ({
  syncCustomPiProviders: jest.fn(),
}));
jest.mock('@pivi/engine-pi/piChatUiConfig', () => ({ piChatUIConfig: {} }));
jest.mock('@pivi/engine-pi/piModelRegistry', () => ({
  getPiAiModelsForProvider: () => [],
}));
jest.mock('@pivi/engine-pi/piSettingsCoordinator', () => ({
  PiSettingsCoordinator: {
    getSettingsSnapshot: (value: unknown) => value,
    commitSettingsSnapshot: () => {},
  },
}));
jest.mock('@pivi/obsidian-host/createPiviNetworkClients', () => ({
  getActivePiviNetworkClients: () => ({
    localProviderHttpClient: {},
    grants: { revokeByPurpose: jest.fn() },
  }),
}));
jest.mock('@/app/workspace/obsidianHttpRequest', () => ({
  createCustomProviderHttpRequest: () => jest.fn(),
}));

const DGX_PROVIDER_ID = 'custom-openai-compatible-5bbe1d19934e';

function createDgxProvider(): CustomProviderConfig {
  const config = createDefaultCustomProviderConfig('openai-compatible', [], {
    name: 'DGX Spark',
    baseUrl: 'http://192.168.100.114:8888/v1',
  });
  return {
    ...config,
    id: DGX_PROVIDER_ID,
    models: [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b', contextWindow: 262144 }],
  };
}

function createSettings(overrides?: {
  model?: string;
  visibleModels?: string[];
  titleGenerationModel?: string;
  lastModel?: string;
}): Record<string, unknown> {
  return {
    ...DEFAULT_PIVI_SETTINGS,
    model: overrides?.model ?? `${DGX_PROVIDER_ID}/qwen3.8-27b`,
    titleGenerationModel: overrides?.titleGenerationModel ?? '',
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      addedProviders: ['openai-codex', DGX_PROVIDER_ID],
      disabledProviders: [],
      visibleModels: overrides?.visibleModels ?? [
        `${DGX_PROVIDER_ID}/qwen3.8-27b`,
        `${DGX_PROVIDER_ID}/deepseek-v4-flash-0731`,
        'openai-codex/gpt-5.6-luna',
      ],
      customProviders: [createDgxProvider()],
      ...(overrides?.lastModel !== undefined ? { lastModel: overrides.lastModel } : {}),
    },
  };
}

describe('createPiUiFacades fetchCustomProviderModels', () => {
  beforeEach(() => {
    jest.mocked(fetchCustomProviderModels).mockReset().mockResolvedValue({
      models: [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b', contextWindow: 262144 }],
    });
  });

  it('prunes visible models the endpoint no longer lists', async () => {
    const settings = createSettings();
    const facades = createPiUiFacades();

    const result = await facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);

    expect(result).toEqual({ count: 1 });
    expect(getPiAgentSettings(settings).visibleModels).toEqual([
      `${DGX_PROVIDER_ID}/qwen3.8-27b`,
      'openai-codex/gpt-5.6-luna',
    ]);
    expect(jest.mocked(syncCustomPiProviders)).toHaveBeenCalled();
  });

  it('replaces the stored provider models with the fetched list', async () => {
    const settings = createSettings();
    const facades = createPiUiFacades();

    await facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);

    const provider = getPiAgentSettings(settings).customProviders
      .find((entry) => entry.id === DGX_PROVIDER_ID);
    expect(provider?.models.map((model) => model.id)).toEqual(['qwen3.8-27b']);
  });

  it('reassigns a pruned active model and clears pruned title/last models', async () => {
    const settings = createSettings({
      model: `${DGX_PROVIDER_ID}/deepseek-v4-flash-0731`,
      titleGenerationModel: `${DGX_PROVIDER_ID}/deepseek-v4-flash-0731`,
      lastModel: `${DGX_PROVIDER_ID}/deepseek-v4-flash-0731`,
    });
    const facades = createPiUiFacades();

    await facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);

    expect(settings.model).toBe(`${DGX_PROVIDER_ID}/qwen3.8-27b`);
    expect(settings.titleGenerationModel).toBe('');
    expect(settings.agentSettings).toMatchObject({ lastModel: '' });
  });

  it('keeps the active model when it survives the fetch', async () => {
    const settings = createSettings({ model: 'openai-codex/gpt-5.6-luna' });
    const facades = createPiUiFacades();

    await facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);

    expect(settings.model).toBe('openai-codex/gpt-5.6-luna');
    expect(getPiAgentSettings(settings).visibleModels).toEqual([
      `${DGX_PROVIDER_ID}/qwen3.8-27b`,
      'openai-codex/gpt-5.6-luna',
    ]);
  });

  it('keeps a catalog mapping saved while a model fetch is pending', async () => {
    let resolveFetch!: (value: {
      models: CustomProviderConfig['models'];
    }) => void;
    jest.mocked(fetchCustomProviderModels).mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const settings = createSettings();
    const facades = createPiUiFacades();

    const pendingFetch = facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);
    const current = getPiAgentSettings(settings);
    updatePiAgentSettings(settings, {
      customProviders: current.customProviders.map((provider) => provider.id === DGX_PROVIDER_ID
        ? {
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            catalogModelId: 'qwen/qwen3.5-27b',
          })),
        }
        : provider),
    });
    resolveFetch({
      models: [{ id: 'qwen3.8-27b', name: 'qwen3.8-27b', contextWindow: 262144 }],
    });

    await pendingFetch;

    const provider = getPiAgentSettings(settings).customProviders
      .find((entry) => entry.id === DGX_PROVIDER_ID);
    expect(provider?.models[0]?.catalogModelId).toBe('qwen/qwen3.5-27b');
  });

  it('keeps a catalog mapping cleared while a model fetch is pending', async () => {
    let resolveFetch!: (value: {
      models: CustomProviderConfig['models'];
    }) => void;
    jest.mocked(fetchCustomProviderModels).mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const settings = createSettings();
    const initial = getPiAgentSettings(settings);
    updatePiAgentSettings(settings, {
      customProviders: initial.customProviders.map((provider) => provider.id === DGX_PROVIDER_ID
        ? {
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            catalogModelId: 'qwen/qwen3.5-27b',
          })),
        }
        : provider),
    });
    const facades = createPiUiFacades();

    const pendingFetch = facades.fetchCustomProviderModels(DGX_PROVIDER_ID, settings);
    const current = getPiAgentSettings(settings);
    updatePiAgentSettings(settings, {
      customProviders: current.customProviders.map((provider) => provider.id === DGX_PROVIDER_ID
        ? {
          ...provider,
          models: provider.models.map((model) => {
            const { catalogModelId: _catalogModelId, ...withoutCatalogModelId } = model;
            return withoutCatalogModelId;
          }),
        }
        : provider),
    });
    resolveFetch({
      models: [{
        id: 'qwen3.8-27b',
        name: 'qwen3.8-27b',
        contextWindow: 262144,
        catalogModelId: 'qwen/qwen3.5-27b',
      }],
    });

    await pendingFetch;

    const provider = getPiAgentSettings(settings).customProviders
      .find((entry) => entry.id === DGX_PROVIDER_ID);
    expect(provider?.models[0]?.catalogModelId).toBeUndefined();
  });
});
