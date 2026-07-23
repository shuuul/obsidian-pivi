import { PIVI_SETTINGS_PATH } from '@pivi/obsidian-host/settings/piviSettingsStorage';
import type { FileStore } from '@pivi/pivi-agent-core/ports';
import { App } from 'obsidian';

import {
  DEVICE_LOCAL_PROVIDER_STORAGE_KEY,
  ObsidianDeviceLocalProviderStore,
} from '@/app/deviceLocalProviderStore';
import { runDeviceLocalProviderMigration } from '@/app/settings/deviceLocalProviderMigration';
import { createMockApp } from '../../../helpers/mockApp';

function createMemoryAdapter(initialContent?: string): FileStore & { writes: string[] } {
  let content = initialContent;
  const adapter = {
    writes: [] as string[],
    exists: jest.fn(async () => content !== undefined),
    read: jest.fn(async () => content ?? ''),
    write: jest.fn(async (_path: string, nextContent: string) => {
      content = nextContent;
      adapter.writes.push(nextContent);
    }),
    delete: jest.fn(),
    deleteFolder: jest.fn(),
    listFolders: jest.fn(async () => []),
    ensureFolder: jest.fn(),
  };
  return adapter as unknown as FileStore & { writes: string[] };
}

describe('device local provider migration coordinator', () => {
  it('seeds defaults on fresh install and strips synced provider fields', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter();
    const store = new ObsidianDeviceLocalProviderStore(app);
    const result = await runDeviceLocalProviderMigration({
      app,
      rawSettings: null,
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
    });

    expect(result.cutoverPerformed).toBe(true);
    expect(store.isInitialized()).toBe(true);
    expect(result.settings.model).toBe('deepseek/deepseek-chat');
    expect(result.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    const persisted = JSON.parse(adapter.writes.at(-1) ?? '{}') as Record<string, unknown>;
    const agentSettings = persisted.agentSettings as Record<string, unknown>;
    expect(agentSettings).not.toHaveProperty('addedProviders');
    expect(agentSettings).not.toHaveProperty('visibleModels');
    expect(persisted).not.toHaveProperty('model');
  });

  it('migrates legacy provider membership, headers, and webSearchTools on cutover', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter();
    const store = new ObsidianDeviceLocalProviderStore(app);
    const raw = {
      model: 'openai/gpt-4.1',
      titleGenerationModel: '',
      agentSettings: {
        addedProviders: ['openai', 'my-openai'],
        visibleModels: ['openai/gpt-4.1'],
        webSearchTools: {
          providerOrder: ['brave', 'tavily'],
          disabledProviders: ['tavily'],
        },
        customProviders: [{
          id: 'my-openai',
          kind: 'openai-compatible',
          name: 'Proxy',
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          headers: { Authorization: 'Bearer header-secret' },
          models: [{ id: 'gpt-4.1', name: 'GPT 4.1' }],
        }],
      },
    };

    const result = await runDeviceLocalProviderMigration({
      app,
      rawSettings: raw,
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
    });

    expect(result.cutoverPerformed).toBe(true);
    expect(result.settings.agentSettings.addedProviders).toEqual(['openai', 'my-openai']);
    expect(result.settings.agentSettings.customProviders?.[0]?.headers).toBeUndefined();
    expect(result.settings.agentSettings.webSearchTools).toEqual({
      providerOrder: ['brave', 'tavily'],
      disabledProviders: ['tavily'],
    });
    const local = app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY) as {
      webSearchTools: { providerOrder: string[] };
    };
    expect(local.webSearchTools.providerOrder).toEqual(['brave', 'tavily']);
  });

  it('strips reintroduced synced provider fields on already-initialized devices', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter(JSON.stringify({
      agentSettings: { environmentVariables: 'PI_ENABLE_EXA=1' },
    }));
    const store = new ObsidianDeviceLocalProviderStore(app);
    store.save({
      version: 1,
      initialized: true,
      providers: [{ id: 'deepseek', type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      },
    });

    const result = await runDeviceLocalProviderMigration({
      app,
      rawSettings: {
        agentSettings: {
          addedProviders: ['openai'],
          visibleModels: ['openai/gpt-4.1'],
          environmentVariables: 'PI_ENABLE_EXA=1',
        },
        model: 'openai/gpt-4.1',
      },
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
    });

    expect(result.cutoverPerformed).toBe(false);
    expect(result.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    expect(adapter.writes.length).toBeGreaterThan(0);
    const persisted = JSON.parse(adapter.writes.at(-1) ?? '{}') as Record<string, unknown>;
    const agentSettings = persisted.agentSettings as Record<string, unknown>;
    expect(agentSettings).not.toHaveProperty('addedProviders');
    expect(agentSettings).not.toHaveProperty('visibleModels');
    expect(persisted).not.toHaveProperty('model');
    // Spec 031: environment values are device-local and must not remain in synced settings.
    expect(agentSettings).not.toHaveProperty('environmentVariables');
    expect(persisted).not.toHaveProperty('sharedEnvironmentVariables');
  });

  it('is idempotent when initialized local state and synced settings are already clean', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter(JSON.stringify({
      agentSettings: { environmentVariables: 'PI_ENABLE_EXA=1' },
    }));
    const store = new ObsidianDeviceLocalProviderStore(app);
    store.save({
      version: 1,
      initialized: true,
      providers: [{ id: 'deepseek', type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      },
    });

    const writesBefore = adapter.writes.length;
    const result = await runDeviceLocalProviderMigration({
      app,
      rawSettings: {
        agentSettings: { environmentVariables: 'PI_ENABLE_EXA=1' },
      },
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
    });

    expect(result.cutoverPerformed).toBe(false);
    expect(result.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    expect(adapter.writes.length).toBe(writesBefore);
  });

  it('retains local state when synced strip save fails after local commit', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter();
    const store = new ObsidianDeviceLocalProviderStore(app);

    const result = await runDeviceLocalProviderMigration({
      app,
      rawSettings: null,
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: async () => {
        throw new Error('synced save failed');
      },
    });

    expect(result.cutoverPerformed).toBe(true);
    expect(result.syncedSaveFailed).toBe(true);
    expect(store.isInitialized()).toBe(true);
    expect(result.settings.model).toBe('deepseek/deepseek-chat');
    expect(adapter.writes).toHaveLength(0);
  });

  it('aborts cutover when local state write fails', async () => {
    const app = createMockApp();
    const adapter = createMemoryAdapter();
    const store = {
      loadInitialized: () => null,
      isInitialized: () => false,
      save: () => {
        throw new Error('local write failed');
      },
    };

    await expect(runDeviceLocalProviderMigration({
      app,
      rawSettings: {
        agentSettings: { addedProviders: ['openai'], visibleModels: ['openai/gpt-4.1'] },
        model: 'openai/gpt-4.1',
      },
      deviceLocalStore: store,
      vaultAdapter: adapter,
      savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
    })).rejects.toThrow('Failed to save device-local provider state');
    expect(adapter.writes).toHaveLength(0);
  });
});

describe('plugin settings load ordering', () => {
  it('runs migration before session store construction', async () => {
    const order: string[] = [];
    const app = new App();
    const adapter = createMemoryAdapter();
    const { loadPluginSettings } = await import('@/app/pluginSettingsLoad');
    const { DEFAULT_PIVI_SETTINGS } = await import('@pivi/pivi-agent-core/foundation/settingsDefaults');
    let settings = structuredClone(DEFAULT_PIVI_SETTINGS);

    await loadPluginSettings({
      app,
      storage: {
        initialize: async () => {
          order.push('initialize');
        },
        loadRawPiviSettings: async () => {
          order.push('raw-load');
          return null;
        },
        saveRawPiviSettings: async () => {
          order.push('raw-save');
        },
        getAdapter: () => adapter,
      },
      sessionManager: {
        loadSummaries: async () => {
          order.push('session-summaries');
        },
        backfillSessionResponseTimestamps: () => [],
      } as never,
      createSessionStore: () => {
        order.push('session-store');
        return { migrateDeviceLocalExternalContexts: async () => 0 } as never;
      },
      hideDeletedSessionSummaries: async () => undefined,
      persistSessionSummary: async () => undefined,
      saveSettings: async () => undefined,
      setSettings: (next) => {
        settings = next;
      },
      setSessionStore: () => undefined,
      getSettings: () => settings,
      getSessions: () => [],
      setLastKnownTabManagerState: () => undefined,
      getStorage: () => ({ getTabManagerState: async () => null }),
      skillsHost: {} as never,
    });

    expect(order.indexOf('raw-load')).toBeLessThan(order.indexOf('session-store'));
    expect(order.indexOf('raw-save')).toBeLessThan(order.indexOf('session-store'));
  });
});
