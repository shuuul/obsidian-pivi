import {
  getPiAiCredentialSecretId,
  serializeProviderCredential,
} from '@pivi/agent/auth/piProviderCredentials';
import { PIVI_SETTINGS_PATH } from '@pivi/obsidian-host/settings/piviSettingsStorage';
import type { FileStore } from '@pivi/agent/ports';
import { App, Notice } from 'obsidian';

import { ObsidianDeviceLocalProviderStore } from '@/app/deviceLocalProviderStore';
import { runDeviceLocalProviderMigration } from '@/app/settings/deviceLocalProviderMigration';
import { createMockApp } from '../../../helpers/mockApp';
import { ObsidianDeviceLocalCapabilityPermissionStore } from '@/app/deviceLocalCapabilityPermissionStore';
import { ObsidianDeviceLocalExternalContextStore } from '@/app/deviceLocalExternalContextStore';

jest.mock('@pivi/agent/skills/vault/ensureDefaultVaultSkills', () => ({
  ensureDefaultVaultSkills: jest.fn(async () => undefined),
}));

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

    await migrateOnDevice(appA, adapter, { locale: 'en', userName: 'Alice' });
    new ObsidianDeviceLocalProviderStore(appA).save({
      version: 1,
      initialized: true,
      providers: [
        { id: 'openai', type: 'builtin', disabled: false },
        { id: 'anthropic', type: 'builtin', disabled: false },
      ],
      modelPreferences: {
        visibleModels: ['openai/gpt-4.1'],
        activeModel: 'openai/gpt-4.1',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      },
    });
    appA.secretStorage.setSecret(
      getPiAiCredentialSecretId('openai'),
      serializeProviderCredential({ type: 'api_key', key: 'device-a-openai' }),
    );

    const initialB = await migrateOnDevice(appB, adapter, parseSyncedSettings(adapter));
    expect(initialB.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    new ObsidianDeviceLocalProviderStore(appB).save({
      version: 1,
      initialized: true,
      providers: [{ id: 'deepseek', type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-flash'],
        activeModel: 'deepseek/deepseek-flash',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
        disabledProviders: [],
      },
    });
    appB.secretStorage.setSecret(
      getPiAiCredentialSecretId('deepseek'),
      serializeProviderCredential({ type: 'api_key', key: 'device-b-deepseek' }),
    );

    const resultA = await migrateOnDevice(appA, adapter, parseSyncedSettings(adapter));
    const resultB = await migrateOnDevice(appB, adapter, parseSyncedSettings(adapter));
    const synced = parseSyncedSettings(adapter);

    expect(resultA.settings.agentSettings.addedProviders).toEqual(['openai', 'anthropic']);
    expect(resultB.settings.agentSettings.addedProviders).toEqual(['deepseek']);
    expect(resultA.settings.agentSettings.webSearchTools?.providerOrder[0]).toBe('brave');
    expect(resultB.settings.agentSettings.webSearchTools?.providerOrder[0]).toBe('tavily');
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
    expect(resultB.settings.model).toBe('deepseek/deepseek-flash');
    expect(parseSyncedSettings(adapter).agentSettings).not.toHaveProperty('addedProviders');
  });

  it('surfaces a localized notice when synced settings save fails after local commit', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = createMockApp();
    const adapter = createSharedSyncedAdapter();
    const { loadPluginSettings } = await import('@/app/pluginSettingsLoad');
    const { DEFAULT_PIVI_SETTINGS } = await import('@pivi/agent/settings/defaults');
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
        takeDeletedSessionFileQueue: async () => [],
      },
      sessionManager: {
        loadSummaries: async () => undefined,
        backfillSessionResponseTimestamps: () => [],
      } as never,
      createSessionStore: () => ({
        migrateDeviceLocalExternalContexts: async () => 0,
        listSessions: async () => [],
        deleteSession: async () => undefined,
      }) as never,
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
      capabilityPermissions: new ObsidianDeviceLocalCapabilityPermissionStore(app),
      legacyExternalContexts: new ObsidianDeviceLocalExternalContextStore(app),
      skillsHost: { app } as never,
    });

    expect(Notice).toHaveBeenCalled();
    expect(settings.agentSettings.addedProviders).toEqual(['deepseek']);
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
