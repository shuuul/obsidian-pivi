import type { FileStore } from "@pivi/agent/ports";
import type { DeviceLocalProviderStateV1 } from "@pivi/agent/settings/deviceLocalProviderState";
import type { PiviSettings } from "@pivi/agent/settings/types";
import type { DeviceLocalCapabilityPermissions as CapabilitySnapshot } from "@pivi/agent/tools";
import { PiviSettingsStorage } from '@pivi/obsidian-host/settings/piviSettingsStorage';

import {
  createPiviSettingsCodec,
  type DeviceLocalCapabilityPermissions,
  normalizeStoredPiviSettings,
  overlayDeviceLocalCapabilityPermissions,
} from "@/app/settings/piviSettingsCodec";

function createDeviceLocalProviderStore(initialState?: DeviceLocalProviderStateV1 | null) {
  let state: DeviceLocalProviderStateV1 | null = initialState ?? null;
  return {
    loadInitialized: (): DeviceLocalProviderStateV1 | null => state,
    save: (next: DeviceLocalProviderStateV1) => {
      state = { ...next, version: 1, initialized: true };
    },
    getState: () => state,
  };
}

const EMPTY_CAPABILITIES: CapabilitySnapshot = {
  version: 2,
  bash: [],
  externalDirectories: [],
  obsidianCommands: [],
};

/** In-memory device store; `sourceVersion` 1 models a record written before command grants. */
function createCapabilityStore(
  initial: CapabilitySnapshot | null = null,
  sourceVersion: 1 | 2 = 2,
): DeviceLocalCapabilityPermissions & { current(): CapabilitySnapshot; sourceVersion(): 1 | 2 } {
  let snapshot = initial;
  let version = sourceVersion;
  return {
    hasRecord: () => snapshot !== null,
    needsLegacyCommandGrantMigration: () => snapshot !== null && version === 1,
    getSnapshot: () => snapshot ?? EMPTY_CAPABILITIES,
    save: (next) => {
      snapshot = next;
      version = 2;
      return next;
    },
    current: () => snapshot ?? EMPTY_CAPABILITIES,
    sourceVersion: () => version,
  };
}

function createMemoryAdapter(): Pick<FileStore, "exists" | "read" | "write"> & {
  writes: string[];
} {
  let content: string | undefined;
  const adapter: Pick<FileStore, "exists" | "read" | "write"> & { writes: string[] } = {
    writes: [],
    exists: jest.fn(async () => content !== undefined),
    read: jest.fn(async () => content ?? ""),
    write: jest.fn(async (_path: string, nextContent: string) => {
      content = nextContent;
      adapter.writes.push(nextContent);
    }),
  };
  return adapter;
}

type PersistedBag = Record<string, unknown> & {
  agentSettings: Record<string, unknown> & {
    obsidianTools?: Record<string, unknown>;
    webSearchTools?: Record<string, unknown>;
    subagents?: unknown;
  };
  promptModules: Record<string, unknown>;
};

/** Saves through the production storage and codec; returns the synced file content. */
async function persist(
  settings: PiviSettings,
  providers = createDeviceLocalProviderStore(),
  capabilities = createCapabilityStore(),
): Promise<PersistedBag> {
  const adapter = createMemoryAdapter();
  const storage = new PiviSettingsStorage(
    adapter as unknown as FileStore,
    createPiviSettingsCodec(providers, capabilities),
  );
  await storage.save(settings);
  return JSON.parse(adapter.writes.at(-1) ?? "{}") as PersistedBag;
}

function externalFixturePath(unixPath: string): string {
  return process.platform === 'win32'
    ? `C:${unixPath.replaceAll('/', '\\')}`
    : unixPath;
}

describe("Pivi settings normalization and save projection", () => {
  it("backfills a 30-day deleted-session retention window", async () => {
    const settings = normalizeStoredPiviSettings({});

    expect(settings.deletedSessionRetentionDays).toBe(30);
    expect((await persist(settings)).deletedSessionRetentionDays).toBe(30);
  });

  it("repairs invalid deleted-session retention values", () => {
    expect(normalizeStoredPiviSettings({ deletedSessionRetentionDays: 0 }))
      .toMatchObject({ deletedSessionRetentionDays: 30 });
  });

  it("persists default subagent settings when an existing settings record omits them", async () => {
    const settings = normalizeStoredPiviSettings({
      agentSettings: { visibleModels: ["opencode-go/deepseek-v4-flash"] },
    });

    expect(settings.agentSettings.subagents).toEqual({
      allowBackground: true,
      enabled: true,
      maxConcurrentSubagents: 3,
    });
    expect((await persist(settings)).agentSettings.subagents).toEqual(
      settings.agentSettings.subagents,
    );
  });

  it("preserves an explicit subagent concurrency limit across save and load", async () => {
    const settings = normalizeStoredPiviSettings({});
    settings.agentSettings.subagents = {
      allowBackground: true,
      enabled: true,
      maxConcurrentSubagents: 8,
    };

    const reloaded = normalizeStoredPiviSettings(await persist(settings));

    expect(reloaded.agentSettings.subagents?.maxConcurrentSubagents).toBe(8);
  });

  it('migrates legacy web provider preferences to the ordered provider queue', () => {
    const settings = normalizeStoredPiviSettings({
      agentSettings: {
        webSearchTools: { searchProvider: 'exa', fetchProvider: 'tavily' },
      },
    });

    expect(settings.agentSettings.webSearchTools).toEqual({
      providerOrder: ['exa', 'tavily', 'brave', 'anysearch'],
      disabledProviders: [],
    });
  });

  it("removes legacy settings-backed custom system prompt on load", async () => {
    const settings = normalizeStoredPiviSettings({
      userName: "Alice",
      model: "opencode-go/deepseek-v4-flash",
      systemPrompt: "Legacy custom instructions",
    });

    expect(settings).not.toHaveProperty("systemPrompt");
    expect(await persist(settings)).not.toHaveProperty("systemPrompt");
  });

  it("normalizes agent settings through the active runtime registration", () => {
    const settings = normalizeStoredPiviSettings({
      agentSettings: {
        visibleModels: ["unknown-provider/model"],
      },
      model: "unknown-provider/model",
    });

    expect(settings.model).toBe("deepseek/deepseek-flash");
    expect(settings.agentSettings.visibleModels).toEqual([
      "deepseek/deepseek-flash",
    ]);
  });

  it("removes legacy compaction settings on load", async () => {
    const settings = normalizeStoredPiviSettings({
      enableAutoCompact: "yes",
      autoCompactThresholdRatio: 2,
      autoCompactKeepRecentTokens: 250,
    });

    expect(settings).not.toHaveProperty("enableAutoCompact");
    expect(settings).not.toHaveProperty("autoCompactThresholdRatio");
    expect(settings).not.toHaveProperty("autoCompactKeepRecentTokens");
    expect(JSON.stringify(await persist(settings))).not.toContain("autoCompact");
  });

  it("removes retired agent settings fields on load", async () => {
    const settings = normalizeStoredPiviSettings({
      agentSettings: { selectedMode: "default", environmentHash: "abc", visibleModels: [] },
    });

    expect(settings.agentSettings).not.toHaveProperty("selectedMode");
    expect(settings.agentSettings).not.toHaveProperty("environmentHash");
    expect(JSON.stringify(await persist(settings))).not.toContain("selectedMode");
  });

  it("migrates legacy external pins into Obsidian tool settings", () => {
    const settings = normalizeStoredPiviSettings({
      persistentExternalContextPaths: [` ${externalFixturePath('/tmp/legacy')}/ `, externalFixturePath('/tmp/shared')],
      agentSettings: {
        obsidianTools: {
          externalReadDirectories: [externalFixturePath('/tmp/current'), `${externalFixturePath('/tmp/shared')}/`],
        },
      },
    });

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      externalFixturePath('/tmp/current'),
      externalFixturePath('/tmp/shared'),
      externalFixturePath('/tmp/legacy'),
    ]);
    expect(settings).not.toHaveProperty("persistentExternalContextPaths");
  });

  it("migrates legacy external pins when Obsidian tool settings are absent", () => {
    const settings = normalizeStoredPiviSettings({
      persistentExternalContextPaths: [externalFixturePath('/tmp/legacy')],
    });

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      externalFixturePath('/tmp/legacy'),
    ]);
  });

  it("normalizes and deduplicates current external read directories", () => {
    const settings = normalizeStoredPiviSettings({
      agentSettings: {
        obsidianTools: {
          externalReadDirectories: [` ${externalFixturePath('/tmp/current')}/ `, externalFixturePath('/tmp/current')],
        },
      },
    });

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      externalFixturePath('/tmp/current'),
    ]);
  });

  it('migrates legacy bashAllowlist into device-local permissions and strips synced fields', async () => {
    const capabilities = createCapabilityStore();
    const stored = {
      agentSettings: {
        obsidianTools: {
          bashAllowlist: ['git', 'ls'],
          commandAllowlist: ['workspace:split'],
          externalReadDirectories: [externalFixturePath('/synced/legacy')],
        },
      },
    };
    const settings = normalizeStoredPiviSettings(stored);

    // The synced file still carries grants, so the caller must save to strip them.
    expect(overlayDeviceLocalCapabilityPermissions(settings, stored, capabilities)).toBe(true);

    expect(settings.agentSettings.obsidianTools?.bashPermissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'executable',
          executable: { kind: 'name', value: 'git' },
          enabled: true,
        }),
        expect.objectContaining({
          kind: 'executable',
          executable: { kind: 'name', value: 'ls' },
          enabled: true,
        }),
      ]),
    );
    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      externalFixturePath('/synced/legacy'),
    ]);
    expect(settings.agentSettings.obsidianTools?.commandAllowlist).toEqual(['workspace:split']);
    expect(capabilities.current().obsidianCommands).toEqual(['workspace:split']);
    const persisted = await persist(settings, undefined, capabilities);
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('bashAllowlist');
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('bashPermissions');
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('externalReadDirectories');
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('commandAllowlist');
  });

  const gitGrant = {
    kind: 'executable' as const,
    executable: { kind: 'name' as const, value: 'git' },
    enabled: true,
  };

  it('migrates synced command grants exactly once from a v1 capability record', async () => {
    const capabilities = createCapabilityStore({
      version: 2,
      bash: [gitGrant],
      externalDirectories: [],
      obsidianCommands: ['editor:toggle-bold'],
    }, 1);
    const stored = {
      agentSettings: {
        obsidianTools: { commandAllowlist: ['workspace:split'] },
      },
    };
    const settings = normalizeStoredPiviSettings(stored);

    overlayDeviceLocalCapabilityPermissions(settings, stored, capabilities);

    expect(capabilities.current().obsidianCommands).toEqual(['editor:toggle-bold', 'workspace:split']);
    expect(settings.agentSettings.obsidianTools?.commandAllowlist).toEqual([
      'editor:toggle-bold',
      'workspace:split',
    ]);
    const persisted = await persist(settings, undefined, capabilities);
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('commandAllowlist');
  });

  it('does not elevate a synced command allowlist when a v2 local record exists', () => {
    const capabilities = createCapabilityStore({
      version: 2,
      bash: [gitGrant],
      externalDirectories: [],
      obsidianCommands: ['editor:toggle-bold'],
    });
    const stored = {
      agentSettings: {
        obsidianTools: { commandAllowlist: ['workspace:split'] },
      },
    };
    const settings = normalizeStoredPiviSettings(stored);

    expect(overlayDeviceLocalCapabilityPermissions(settings, stored, capabilities)).toBe(true);

    expect(capabilities.current().obsidianCommands).toEqual(['editor:toggle-bold']);
    expect(settings.agentSettings.obsidianTools?.commandAllowlist).toEqual([
      'editor:toggle-bold',
    ]);
  });

  it('consumes the v1 command migration even when the synced field is absent', () => {
    const capabilities = createCapabilityStore({
      version: 2,
      bash: [gitGrant],
      externalDirectories: [{ realpath: externalFixturePath('/device/root'), enabled: true }],
      obsidianCommands: [],
    }, 1);

    overlayDeviceLocalCapabilityPermissions(normalizeStoredPiviSettings({}), {}, capabilities);

    expect(capabilities.sourceVersion()).toBe(2);
    expect(capabilities.current().bash).toHaveLength(1);
    expect(capabilities.current().externalDirectories).toEqual([
      { realpath: externalFixturePath('/device/root'), enabled: true },
    ]);

    const conflicted = {
      agentSettings: {
        obsidianTools: { commandAllowlist: ['workspace:split'] },
      },
    };
    const reloaded = normalizeStoredPiviSettings(conflicted);
    overlayDeviceLocalCapabilityPermissions(reloaded, conflicted, capabilities);

    expect(capabilities.current().obsidianCommands).toEqual([]);
    expect(reloaded.agentSettings.obsidianTools?.commandAllowlist).toEqual([]);
  });

  it('moves legacy device and synced external roots into the capability store', async () => {
    const legacyDirectories = [externalFixturePath('/device/root')];
    const legacyStore = {
      getExternalReadDirectories: () => [...legacyDirectories],
      setExternalReadDirectories: (paths: readonly string[]) => {
        legacyDirectories.splice(0, legacyDirectories.length, ...paths);
      },
    };
    const capabilities = createCapabilityStore();
    const stored = {
      agentSettings: {
        obsidianTools: { externalReadDirectories: [externalFixturePath('/synced/legacy')] },
      },
    };
    const settings = normalizeStoredPiviSettings(stored);

    overlayDeviceLocalCapabilityPermissions(settings, stored, capabilities, legacyStore);

    const roots = [externalFixturePath('/device/root'), externalFixturePath('/synced/legacy')];
    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual(roots);
    expect(legacyDirectories).toEqual([]);
    const persisted = await persist(settings, undefined, capabilities);
    expect(persisted.agentSettings.obsidianTools).not.toHaveProperty('externalReadDirectories');
    expect(capabilities.current().externalDirectories).toEqual(
      roots.map((realpath) => ({ realpath, enabled: true })),
    );
  });

  const deepseekProviderState: DeviceLocalProviderStateV1 = {
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
      providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
      disabledProviders: [],
    },
  };

  it('saves provider state to device-local storage and strips it from synced settings', async () => {
    const localStore = createDeviceLocalProviderStore(deepseekProviderState);
    const settings = normalizeStoredPiviSettings({});
    settings.agentSettings.webSearchTools = {
      providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
      disabledProviders: ['brave'],
    };

    const saved = await persist(settings, localStore);

    expect(localStore.getState()?.webSearchTools).toEqual({
      providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
      disabledProviders: ['brave'],
    });
    expect(saved).not.toHaveProperty('model');
    expect(saved.agentSettings).not.toHaveProperty('addedProviders');
    expect(saved.agentSettings).not.toHaveProperty('webSearchTools');
  });

  it('keeps committed device-local provider state when synced save fails', async () => {
    const localStore = createDeviceLocalProviderStore(deepseekProviderState);
    const adapter = createMemoryAdapter();
    adapter.write = jest.fn(async () => {
      throw new Error('synced write failed');
    });
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(localStore, createCapabilityStore()),
    );
    const settings = normalizeStoredPiviSettings({});
    settings.agentSettings.addedProviders = ['deepseek', 'openai'];

    await expect(storage.save(settings)).rejects.toThrow('synced write failed');
    expect(localStore.getState()?.providers.map((provider) => provider.id))
      .toEqual(['deepseek', 'openai']);
  });

  it('persists normalized editor selection toolbar shortcuts', async () => {
    const settings = normalizeStoredPiviSettings({
      editorSelectionToolbar: {
        shortcuts: [
          {
            id: 'pivi-1',
            kind: 'pivi-command',
            label: '/summarize',
            enabled: true,
            piviCommandKey: 'abc-key',
          },
          {
            id: 'bad',
            kind: 'pivi-command',
            label: 'Missing key',
            enabled: true,
          },
          {
            id: 'legacy',
            kind: 'preset-prompt',
            label: 'Summarize',
            enabled: true,
            prompt: 'Summarize the selection.',
          },
        ],
      },
    });

    expect(settings.editorSelectionToolbar).toEqual({
      enabled: true,
      shortcuts: [
        {
          id: 'inline-edit',
          kind: 'pivi-action',
          actionId: 'inline-edit',
          enabled: true,
        },
        {
          id: 'add-to-chat',
          kind: 'pivi-action',
          actionId: 'add-to-chat',
          enabled: true,
        },
        {
          id: 'pivi-1',
          kind: 'pivi-command',
          label: '/summarize',
          enabled: true,
          piviCommandKey: 'abc-key',
          executionTarget: 'sidebar',
        },
      ],
    });
    expect((await persist(settings)).editorSelectionToolbar).toEqual(
      settings.editorSelectionToolbar,
    );
  });

  it("preserves unknown prompt-module ids and drops invalid custom entries", async () => {
    const settings = normalizeStoredPiviSettings({
      promptModules: {
        "future-shipped-module": { enabled: false, customBody: "keep me" },
        "transcript-cleanup": { customBody: "edited" },
        garbage: "nope",
      },
      customPromptModules: [
        { id: "identity", title: "Collision", body: "nope", enabled: true },
        { id: "custom:ok", title: "Ok", body: "yes", enabled: true },
        { id: "bad" },
      ],
    });

    expect(settings.promptModules["future-shipped-module"]).toEqual({
      enabled: false,
      customBody: "keep me",
    });
    expect(settings.promptModules["transcript-cleanup"]).toEqual({
      customBody: "edited",
    });
    expect(settings.promptModules.garbage).toBeUndefined();
    expect(settings.customPromptModules).toEqual([
      { id: "custom:ok", title: "Ok", body: "yes", enabled: true },
    ]);
    const persisted = await persist(settings);
    expect(persisted.promptModules["future-shipped-module"]).toEqual({
      enabled: false,
      customBody: "keep me",
    });
    expect(persisted.customPromptModules).toEqual([
      { id: "custom:ok", title: "Ok", body: "yes", enabled: true },
    ]);
  });

  it("treats absent prompt-module keys as shipped defaults", () => {
    const settings = normalizeStoredPiviSettings({});

    expect(settings.promptModules).toEqual({});
    expect(settings.customPromptModules).toEqual([]);
  });
});
