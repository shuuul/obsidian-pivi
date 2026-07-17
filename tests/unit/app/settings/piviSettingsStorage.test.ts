import {
  PIVI_SETTINGS_PATH,
  PiviSettingsStorage,
} from '@pivi/obsidian-host/settings/piviSettingsStorage';
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import { createPiviSettingsCodec } from "@/app/settings/piviSettingsCodec";

function createMemoryAdapter(initialContent?: string): Pick<
  FileStore,
  "exists" | "read" | "write"
> & {
  writes: string[];
} {
  let content = initialContent;
  const adapter: Pick<FileStore, "exists" | "read" | "write"> & {
    writes: string[];
  } = {
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

describe("PiviSettingsStorage", () => {

  it("persists default subagent settings when an existing settings record omits them", async () => {
    const adapter = createMemoryAdapter(JSON.stringify({
      agentSettings: { visibleModels: ["opencode-go/deepseek-v4-flash"] },
    }));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.subagents).toEqual({
      allowBackground: true,
      enabled: true,
      maxConcurrentSubagents: 3,
    });
    expect(JSON.parse(adapter.writes.at(-1) ?? "{}").agentSettings.subagents).toEqual(
      settings.agentSettings.subagents,
    );
  });

  it("preserves an explicit subagent concurrency limit across save and load", async () => {
    const adapter = createMemoryAdapter();
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );
    const settings = await storage.load();
    settings.agentSettings.subagents = {
      allowBackground: true,
      enabled: true,
      maxConcurrentSubagents: 8,
    };

    await storage.save(settings);
    const reloaded = await storage.load();

    expect(reloaded.agentSettings.subagents?.maxConcurrentSubagents).toBe(8);
  });

  it('migrates legacy web provider preferences to the ordered provider queue', async () => {
    const adapter = createMemoryAdapter(JSON.stringify({
      agentSettings: {
        webSearchTools: { searchProvider: 'exa', fetchProvider: 'tavily' },
      },
    }));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.webSearchTools).toEqual({
      providerOrder: ['exa', 'tavily', 'brave', 'anysearch'],
      disabledProviders: [],
    });
    const persisted = JSON.parse(adapter.writes.at(-1) ?? '{}');
    expect(persisted.agentSettings.webSearchTools).not.toHaveProperty('searchProvider');
    expect(persisted.agentSettings.webSearchTools).not.toHaveProperty('fetchProvider');
  });

  it("removes legacy settings-backed custom system prompt on load", async () => {
    const stored = {
      userName: "Alice",
      model: "opencode-go/deepseek-v4-flash",
      systemPrompt: "Legacy custom instructions",
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings).not.toHaveProperty("systemPrompt");
    expect(adapter.write).toHaveBeenCalledWith(
      PIVI_SETTINGS_PATH,
      expect.not.stringContaining("Legacy custom instructions"),
    );
    expect(JSON.parse(adapter.writes[0] ?? "{}")).not.toHaveProperty(
      "systemPrompt",
    );
  });

  it("normalizes agent settings through the active runtime registration", async () => {
    const stored = {
      agentSettings: {
        visibleModels: ["unknown-provider/model"],
      },
      model: "unknown-provider/model",
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.model).toBe("opencode-go/deepseek-v4-flash");
    expect(settings.agentSettings.visibleModels).toEqual([
      "opencode-go/deepseek-v4-flash",
    ]);
    expect(adapter.write).toHaveBeenCalledWith(
      PIVI_SETTINGS_PATH,
      expect.any(String),
    );
  });

  it("removes legacy compaction settings on load", async () => {
    const stored = {
      enableAutoCompact: "yes",
      autoCompactThresholdRatio: 2,
      autoCompactKeepRecentTokens: 250,
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings).not.toHaveProperty("enableAutoCompact");
    expect(settings).not.toHaveProperty("autoCompactThresholdRatio");
    expect(settings).not.toHaveProperty("autoCompactKeepRecentTokens");
    expect(adapter.write).toHaveBeenCalledWith(
      PIVI_SETTINGS_PATH,
      expect.not.stringContaining("autoCompactThresholdRatio"),
    );
  });

  it("migrates legacy external pins into Obsidian tool settings", async () => {
    const stored = {
      persistentExternalContextPaths: [" /tmp/legacy/ ", "/tmp/shared"],
      agentSettings: {
        obsidianTools: {
          externalReadDirectories: ["/tmp/current", "/tmp/shared/"],
        },
      },
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      "/tmp/current",
      "/tmp/shared",
      "/tmp/legacy",
    ]);
    expect(settings).not.toHaveProperty("persistentExternalContextPaths");
    expect(JSON.parse(adapter.writes[0] ?? "{}")).not.toHaveProperty(
      "persistentExternalContextPaths",
    );
  });

  it("migrates legacy external pins when Obsidian tool settings are absent", async () => {
    const adapter = createMemoryAdapter(JSON.stringify({
      persistentExternalContextPaths: ["/tmp/legacy"],
    }));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      "/tmp/legacy",
    ]);
  });

  it("normalizes and deduplicates current external read directories", async () => {
    const stored = {
      agentSettings: {
        obsidianTools: {
          externalReadDirectories: [" /tmp/current/ ", "/tmp/current"],
        },
      },
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      "/tmp/current",
    ]);
    expect(adapter.write).toHaveBeenCalledWith(PIVI_SETTINGS_PATH, expect.any(String));
  });

  it('moves external roots into device-local storage and strips them from synced settings', async () => {
    const localDirectories = ['/device/root'];
    const localStore = {
      getExternalReadDirectories: jest.fn(() => [...localDirectories]),
      setExternalReadDirectories: jest.fn((paths: readonly string[]) => {
        localDirectories.splice(0, localDirectories.length, ...paths);
      }),
    };
    const adapter = createMemoryAdapter(JSON.stringify({
      agentSettings: {
        obsidianTools: { externalReadDirectories: ['/synced/legacy'] },
      },
    }));
    const storage = new PiviSettingsStorage(
      adapter as unknown as FileStore,
      createPiviSettingsCodec(localStore),
    );

    const settings = await storage.load();

    expect(settings.agentSettings.obsidianTools?.externalReadDirectories).toEqual([
      '/device/root',
      '/synced/legacy',
    ]);
    expect(localDirectories).toEqual(['/device/root', '/synced/legacy']);
    const persisted = JSON.parse(adapter.writes.at(-1) ?? '{}') as {
      agentSettings?: { obsidianTools?: Record<string, unknown> };
    };
    expect(persisted.agentSettings?.obsidianTools).not.toHaveProperty('externalReadDirectories');

    settings.userName = 'updated';
    await storage.save(settings);
    expect(localDirectories).toEqual(['/device/root', '/synced/legacy']);
  });
});
