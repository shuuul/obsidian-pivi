import {
  getPiAiCredentialSecretId,
  serializeProviderCredential,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { migrateMembershipAwareProviderSecrets } from '@pivi/pivi-agent-core/engine/pi';
import { PIVI_SETTINGS_PATH } from '@pivi/obsidian-host/settings/piviSettingsStorage';
import type { FileStore } from '@pivi/pivi-agent-core/ports';
import { App, Notice } from 'obsidian';

import {
  DEVICE_LOCAL_PROVIDER_STORAGE_KEY,
  ObsidianDeviceLocalProviderStore,
} from '@/app/deviceLocalProviderStore';
import { runDeviceLocalProviderMigration } from '@/app/settings/deviceLocalProviderMigration';
import { createMockApp } from '../../../helpers/mockApp';

function createSharedSyncedAdapter(): FileStore & { writes: string[]; content: string | undefined } {
  let content: string | undefined;
  const adapter = {
    writes: [] as string[],
    get content() {
      return content;
    },
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
  return adapter as unknown as FileStore & { writes: string[]; content: string | undefined };
}

function parseSyncedSettings(adapter: FileStore & { content: string | undefined }): Record<string, unknown> {
  return JSON.parse(adapter.content ?? '{}') as Record<string, unknown>;
}

async function migrateOnDevice(
  app: App,
  adapter: FileStore,
  rawSettings: Record<string, unknown> | null,
): Promise<ReturnType<typeof runDeviceLocalProviderMigration>> {
  const store = new ObsidianDeviceLocalProviderStore(app);
  return runDeviceLocalProviderMigration({
    app,
    rawSettings,
    deviceLocalStore: store,
    vaultAdapter: adapter,
    savePersistedSettings: (stored) => adapter.write(PIVI_SETTINGS_PATH, JSON.stringify(stored)),
  });
}

describe('device-local provider acceptance matrix', () => {
  beforeEach(() => {
    jest.mocked(Notice).mockClear();
  });

  it('keeps independent provider registries for two devices sharing one synced settings file', async () => {
    const adapter = createSharedSyncedAdapter();
    const appA = createMockApp();
    const appB = createMockApp();

    const resultA = await migrateOnDevice(appA, adapter, {
      locale: 'en',
      userName: 'Alice',
      agentSettings: {
        addedProviders: ['openai', 'my-openai'],
        visibleModels: ['openai/gpt-4.1', 'my-openai/gpt-4.1'],
        customProviders: [{
          id: 'my-openai',
          kind: 'openai-compatible',
          name: 'Proxy',
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          models: [{ id: 'gpt-4.1', name: 'GPT 4.1' }],
        }],
        webSearchTools: {
          providerOrder: ['brave'],
          disabledProviders: [],
      fetchMode: 'direct-only',
        },
      },
      model: 'openai/gpt-4.1',
    });
    appA.secretStorage.setSecret(
      getPiAiCredentialSecretId('openai'),
      serializeProviderCredential({ type: 'api_key', key: 'device-a-openai' }),
    );

    const initialB = await migrateOnDevice(appB, adapter, parseSyncedSettings(adapter));
    const storeB = new ObsidianDeviceLocalProviderStore(appB);
    storeB.save({
      version: 1,
      initialized: true,
      providers: [
        { id: 'deepseek', type: 'builtin', disabled: false },
        { id: 'anthropic', type: 'builtin', disabled: false },
      ],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
        disabledProviders: ['exa'],
      fetchMode: 'direct-only',
      },
    });
    appB.secretStorage.setSecret(
      getPiAiCredentialSecretId('deepseek'),
      serializeProviderCredential({ type: 'api_key', key: 'device-b-deepseek' }),
    );
    expect(initialB.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    const resultB = await migrateOnDevice(appB, adapter, parseSyncedSettings(adapter));

    const localA = appA.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY) as {
      providers: Array<{ id: string }>;
      webSearchTools: { providerOrder: string[],
      fetchMode: 'direct-only',
    };
    };
    const localB = appB.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY) as {
      providers: Array<{ id: string }>;
      webSearchTools: { providerOrder: string[],
      fetchMode: 'direct-only',
    };
    };
    const synced = parseSyncedSettings(adapter);

    expect(resultA.settings.agentSettings.addedProviders).toEqual(['openai', 'my-openai']);
    expect(resultB.settings.agentSettings.addedProviders).toEqual(['deepseek', 'anthropic']);
    expect(localA.providers.map((provider) => provider.id)).toEqual(['openai', 'my-openai']);
    expect(localB.providers.map((provider) => provider.id)).toEqual(['deepseek', 'anthropic']);
    expect(localA.webSearchTools.providerOrder).toEqual(['brave']);
    expect(localB.webSearchTools.providerOrder[0]).toBe('tavily');
    expect(synced.userName).toBe('Alice');
    expect(synced).not.toHaveProperty('model');
    expect(synced.agentSettings).not.toHaveProperty('addedProviders');
    expect(appA.secretStorage.getSecret(getPiAiCredentialSecretId('openai'))).toContain('device-a-openai');
    expect(appB.secretStorage.getSecret(getPiAiCredentialSecretId('deepseek'))).toContain('device-b-deepseek');
    expect(appB.secretStorage.getSecret(getPiAiCredentialSecretId('openai'))).toBeNull();
  });

  it('seeds default local registrations when an offline device opens an already-stripped synced file', async () => {
    const adapter = createSharedSyncedAdapter();
    const appA = createMockApp();
    await migrateOnDevice(appA, adapter, {
      agentSettings: {
        addedProviders: ['openai'],
        visibleModels: ['openai/gpt-4.1'],
      },
      model: 'openai/gpt-4.1',
    });

    const appB = createMockApp();
    const resultB = await migrateOnDevice(appB, adapter, parseSyncedSettings(adapter));

    expect(resultB.cutoverPerformed).toBe(true);
    expect(resultB.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    expect(resultB.settings.model).toBe('deepseek/deepseek-chat');
    expect(parseSyncedSettings(adapter).agentSettings).not.toHaveProperty('addedProviders');
  });

  it('registers credential-required legacy providers without a credential as not-ready members', async () => {
    const app = createMockApp();
    const adapter = createSharedSyncedAdapter();
    const result = await migrateOnDevice(app, adapter, {
      agentSettings: {
        addedProviders: ['openai'],
        visibleModels: ['openai/gpt-4.1'],
      },
      model: 'openai/gpt-4.1',
    });

    expect(result.settings.agentSettings.addedProviders).toEqual(['openai']);
    expect(app.secretStorage.getSecret(getPiAiCredentialSecretId('openai'))).toBeNull();
  });

  it('registers keyless legacy local providers immediately without probing', async () => {
    const app = createMockApp();
    const adapter = createSharedSyncedAdapter();
    const result = await migrateOnDevice(app, adapter, {
      agentSettings: {
        addedProviders: ['ollama'],
        visibleModels: ['ollama/llama3'],
        customProviders: [{
          id: 'ollama',
          kind: 'ollama',
          name: 'Ollama',
          baseUrl: 'http://127.0.0.1:11434',
          api: 'openai-completions',
          models: [{ id: 'llama3', name: 'Llama 3' }],
        }],
      },
      model: 'ollama/llama3',
    });

    expect(result.settings.agentSettings.addedProviders).toEqual(['ollama']);
    expect(result.settings.agentSettings.disabledProviders).toEqual([]);
    expect(app.secretStorage.getSecret(getPiAiCredentialSecretId('ollama'))).toBeNull();
  });

  it('migrates member credentials from legacy membership without registering orphan secrets', () => {
    const app = createMockApp();
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('openai'),
      serializeProviderCredential({ type: 'api_key', key: 'member-key' }),
    );
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('anthropic'),
      serializeProviderCredential({ type: 'api_key', key: 'orphan-key' }),
    );

    const migrated = migrateMembershipAwareProviderSecrets(app.secretStorage, {
      addedProviders: ['openai'],
      disabledProviders: [],
      environmentVariables: '',
      visibleModels: ['openai/gpt-4.1'],
      model: 'openai/gpt-4.1',
      titleGenerationModel: '',
      customProviders: [],
    });

    expect(migrated.membership.addedProviders).toEqual(['openai']);
    expect(migrated.changed).toBe(false);
    expect(app.secretStorage.getSecret(getPiAiCredentialSecretId('openai'))).toContain('member-key');
    expect(app.secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toContain('orphan-key');
  });

  it('keeps built-in context limits synced while custom-provider limits stay device-local', async () => {
    const app = createMockApp();
    const adapter = createSharedSyncedAdapter();
    await migrateOnDevice(app, adapter, {
      customContextLimits: {
        'deepseek/deepseek-chat': 64000,
        'my-openai/gpt-4.1': 32000,
      },
      agentSettings: {
        addedProviders: ['deepseek', 'my-openai'],
        visibleModels: ['deepseek/deepseek-chat', 'my-openai/gpt-4.1'],
        customProviders: [{
          id: 'my-openai',
          kind: 'openai-compatible',
          name: 'Proxy',
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          models: [{ id: 'gpt-4.1', name: 'GPT 4.1' }],
        }],
      },
      model: 'deepseek/deepseek-chat',
    });

    const synced = parseSyncedSettings(adapter);
    const local = app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY) as {
      modelPreferences: { customContextLimits: Record<string, number> };
    };

    expect(synced.customContextLimits).toEqual({ 'deepseek/deepseek-chat': 64000 });
    expect(local.modelPreferences.customContextLimits).toEqual({
      'my-openai/gpt-4.1': 32000,
    });
  });

  it('surfaces a localized notice when synced settings save fails after local commit', async () => {
    const app = createMockApp();
    const adapter = createSharedSyncedAdapter();
    const { loadPluginSettings } = await import('@/app/pluginSettingsLoad');
    const { DEFAULT_PIVI_SETTINGS } = await import('@pivi/pivi-agent-core/foundation/settingsDefaults');
    let settings = structuredClone(DEFAULT_PIVI_SETTINGS);

    await loadPluginSettings({
      app,
      storage: {
        initialize: async () => undefined,
        loadRawPiviSettings: async () => null,
        saveRawPiviSettings: async () => {
          throw new Error('synced save failed');
        },
        getAdapter: () => adapter,
      },
      sessionManager: {
        loadSummaries: async () => undefined,
        backfillSessionResponseTimestamps: () => [],
      } as never,
      createSessionStore: () => ({ migrateDeviceLocalExternalContexts: async () => 0 }) as never,
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
      skillsHost: { app } as never,
    });

    expect(Notice).toHaveBeenCalled();
    expect(settings.agentSettings.addedProviders).toEqual(['deepseek']);
  });
});
