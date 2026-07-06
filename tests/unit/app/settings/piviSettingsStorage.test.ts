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

  it("normalizes compaction settings on load", async () => {
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

    expect(settings.enableAutoCompact).toBe(true);
    expect(settings.autoCompactThresholdRatio).toBe(0.95);
    expect(settings.autoCompactKeepRecentTokens).toBe(1000);
    expect(adapter.write).toHaveBeenCalledWith(
      PIVI_SETTINGS_PATH,
      expect.stringContaining('"autoCompactThresholdRatio": 0.95'),
    );
  });
});
