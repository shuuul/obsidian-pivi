import type { FileStore } from '@pivi/agent/ports';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/agent/settings/defaults';
import { seedDefaultDeviceLocalProviderState } from '@pivi/agent/settings/deviceLocalProviderState';

import { getObsidianToolsSettingsFromBag } from '@pivi/agent/settings/types';
import {
  DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
  type DeviceLocalCapabilityPermissions,
} from '@pivi/agent/tools';

import { ObsidianDeviceLocalCapabilityPermissionStore } from '@/app/deviceLocalCapabilityPermissionStore';
import { ObsidianDeviceLocalExternalContextStore } from '@/app/deviceLocalExternalContextStore';
import { ObsidianDeviceLocalProviderStore } from '@/app/deviceLocalProviderStore';
import { createPiviSettingsCodec } from '@/app/settings/piviSettingsCodec';
import { loadPluginSettings } from '@/app/pluginSettingsLoad';
import { createMockApp } from '../../helpers/mockApp';

jest.mock('@pivi/agent/skills/vault/ensureDefaultVaultSkills', () => ({
  ensureDefaultVaultSkills: jest.fn(async () => undefined),
}));

function createMemoryAdapter(): FileStore {
  let content: string | undefined;
  return {
    exists: jest.fn(async () => content !== undefined),
    read: jest.fn(async () => content ?? ''),
    write: jest.fn(async (_path: string, nextContent: string) => {
      content = nextContent;
    }),
    delete: jest.fn(),
    deleteFolder: jest.fn(),
    listFolders: jest.fn(async () => []),
    ensureFolder: jest.fn(),
  } as unknown as FileStore;
}

async function loadThroughStartupPath(
  app: ReturnType<typeof createMockApp>,
  rawSettings: Record<string, unknown> | null = null,
) {
  let settings = structuredClone(DEFAULT_PIVI_SETTINGS);
  const legacyExternalContexts = new ObsidianDeviceLocalExternalContextStore(app);
  const capabilityPermissions = new ObsidianDeviceLocalCapabilityPermissionStore(app);
  const codec = createPiviSettingsCodec(
    new ObsidianDeviceLocalProviderStore(app),
    capabilityPermissions,
  );
  let raw = rawSettings;
  // Mirrors the production save: the codec persists device-local state and
  // strips it from the synced file.
  const saveSettings = jest.fn(async () => {
    raw = JSON.parse(JSON.stringify(codec.prepareForSave(settings))) as Record<string, unknown>;
  });

  await loadPluginSettings({
    app,
    storage: {
      initialize: async () => undefined,
      loadRawPiviSettings: async () => raw,
      saveRawPiviSettings: async (stored) => {
        raw = stored;
      },
      getAdapter: () => createMemoryAdapter(),
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
    saveSettings,
    setSettings: (next) => {
      settings = next;
    },
    setSessionStore: () => undefined,
    getSettings: () => settings,
    getSessions: () => [],
    setLastKnownTabManagerState: () => undefined,
    getStorage: () => ({ getTabManagerState: async () => null }),
    capabilityPermissions,
    legacyExternalContexts,
    skillsHost: { app } as never,
  });

  return {
    settings,
    saveSettings,
    capabilityPermissions,
    save: saveSettings,
    getRaw: () => raw,
    mutate: (update: (current: typeof settings) => void) => update(settings),
  };
}

describe('plugin settings load reconciliation', () => {
  it('repairs an invalid title model on the installed settings snapshot and persists it', async () => {
    const app = createMockApp();
    const providerStore = new ObsidianDeviceLocalProviderStore(app);
    const seeded = seedDefaultDeviceLocalProviderState();
    providerStore.save({
      ...seeded,
      modelPreferences: {
        ...seeded.modelPreferences,
        titleGenerationModel: 'deepseek/stale-title',
      },
    });

    const { settings, saveSettings } = await loadThroughStartupPath(app);

    expect(settings.titleGenerationModel).toBe('');
    expect(saveSettings).toHaveBeenCalled();
  });
});

describe('plugin settings startup restores device-local state', () => {
  const grants: DeviceLocalCapabilityPermissions = {
    version: DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
    bash: [{ kind: 'executable', executable: { kind: 'name', value: 'git' }, enabled: true }],
    obsidianCommands: ['editor:toggle-bold'],
    externalDirectories: [
      { realpath: '/external/enabled', enabled: true },
      { realpath: '/external/disabled', enabled: false },
    ],
  };

  it('restores persistent grants and keeps them through the next save', async () => {
    const app = createMockApp();
    new ObsidianDeviceLocalCapabilityPermissionStore(app).save(grants);
    const expected = new ObsidianDeviceLocalCapabilityPermissionStore(app).getSnapshot();

    const loaded = await loadThroughStartupPath(app);

    const tools = getObsidianToolsSettingsFromBag(loaded.settings);
    expect(tools.bashPermissions).toEqual(expected.bash);
    expect(tools.commandAllowlist).toEqual(['editor:toggle-bold']);
    expect(tools.externalReadDirectories).toEqual(['/external/enabled']);
    expect(tools.externalDirectoryPermissions).toEqual(expected.externalDirectories);

    await loaded.save();

    expect(loaded.capabilityPermissions.getSnapshot()).toEqual(expected);
    const synced = JSON.stringify(loaded.getRaw());
    expect(synced).not.toContain('/external/enabled');
    expect(synced).not.toContain('editor:toggle-bold');
  });

  it('deletes the last external directory instead of leaving it disabled', async () => {
    const app = createMockApp();
    new ObsidianDeviceLocalCapabilityPermissionStore(app).save({
      ...grants,
      externalDirectories: [{ realpath: '/external/only', enabled: true }],
    });
    const loaded = await loadThroughStartupPath(app);

    // What the Settings page commits when the user removes the only directory.
    loaded.mutate((settings) => {
      settings.agentSettings.obsidianTools = {
        ...getObsidianToolsSettingsFromBag(settings),
        externalDirectoryPermissions: [],
        externalReadDirectories: [],
      };
    });
    await loaded.save();

    expect(loaded.capabilityPermissions.getSnapshot().externalDirectories).toEqual([]);
  });

  it('migrates legacy synced grants into the device store and strips them from the synced file', async () => {
    const app = createMockApp();

    const loaded = await loadThroughStartupPath(app, {
      agentSettings: {
        obsidianTools: {
          bashAllowlist: ['git status'],
          commandAllowlist: ['editor:toggle-bold'],
          externalReadDirectories: ['/external/legacy'],
        },
      },
    });

    const snapshot = loaded.capabilityPermissions.getSnapshot();
    expect(snapshot.obsidianCommands).toEqual(['editor:toggle-bold']);
    expect(snapshot.externalDirectories).toEqual([
      { realpath: '/external/legacy', enabled: true },
    ]);
    expect(snapshot.bash.length).toBeGreaterThan(0);
    expect(getObsidianToolsSettingsFromBag(loaded.settings).externalReadDirectories)
      .toEqual(['/external/legacy']);
    expect(loaded.saveSettings).toHaveBeenCalled();
    expect(JSON.stringify(loaded.getRaw())).not.toContain('/external/legacy');
  });

  it('reopens with the last selected model and reasoning level', async () => {
    const app = createMockApp();
    const first = await loadThroughStartupPath(app);
    first.mutate((settings) => {
      settings.model = 'deepseek/deepseek-reasoner';
      settings.agentSettings.visibleModels = ['deepseek/deepseek-reasoner', 'deepseek/deepseek-flash'];
      settings.thinkingLevel = 'high';
    });
    await first.save();

    const second = await loadThroughStartupPath(app, first.getRaw());

    expect(second.settings.model).toBe('deepseek/deepseek-reasoner');
    expect(second.settings.thinkingLevel).toBe('high');
  });

  it('drops retired fields from the loaded settings', async () => {
    const loaded = await loadThroughStartupPath(createMockApp(), {
      permissionMode: 'yolo',
      lastCustomModel: 'x',
      thinkingBudget: 'high',
      agentSettings: { selectedMode: 'plan', lastModel: 'a/b' },
    });

    const bag = loaded.settings as unknown as Record<string, unknown>;
    expect(bag).not.toHaveProperty('permissionMode');
    expect(bag).not.toHaveProperty('lastCustomModel');
    expect(bag).not.toHaveProperty('thinkingBudget');
    expect(loaded.settings.agentSettings).not.toHaveProperty('selectedMode');
    expect(loaded.settings.agentSettings).not.toHaveProperty('lastModel');
  });
});
