import type { App } from "obsidian";

import {
  getInstalledPluginVersion,
  isNoteToolbarInstalled,
  isPluginEnabled,
  setupNoteToolbarIntegration,
  type NoteToolbarIntegrationDependencies,
  type NoteToolbarItemStyle,
} from "@/app/noteToolbarIntegration";

const CONFIG_DIR = ".config";
const DATA_PATH = `${CONFIG_DIR}/plugins/note-toolbar/data.json`;
const COMMAND_ID = "pivi:add-selection-to-chat-input";
const TOOLBAR_ID = "a1111111-1111-4111-8111-111111111111";

function createToolbarConfig(items: unknown[] = []) {
  return {
    version: 20260703.1,
    textToolbar: TOOLBAR_ID,
    toolbars: [
      {
        uuid: TOOLBAR_ID,
        name: "Selection tools",
        items,
      },
    ],
  };
}

function createHarness(options?: {
  cliAvailable?: boolean;
  config?: unknown;
  enabled?: boolean;
  installed?: boolean;
  itemStyle?: NoteToolbarItemStyle;
  version?: string;
}) {
  const files = new Map<string, string>();
  const installed = options?.installed ?? true;
  let enabled = options?.enabled ?? true;
  if (options?.config !== null) {
    files.set(DATA_PATH, JSON.stringify(options?.config ?? createToolbarConfig()));
  }

  const runCli = jest.fn(async (args: string[]): Promise<string> => {
    if (args[0] === "plugin:enable") {
      enabled = true;
      return "Enabled note-toolbar";
    }
    if (args[0] === "note-toolbar:add-command") {
      const config = JSON.parse(files.get(DATA_PATH) ?? "{}") as ReturnType<
        typeof createToolbarConfig
      >;
      const label = args.find((arg) => arg.startsWith("label="))?.slice(6) ?? "";
      const icon = args.find((arg) => arg.startsWith("icon="))?.slice(5) ?? "";
      const commandId = args.find((arg) => arg.startsWith("command="))?.slice(8) ?? "";
      const [toolbar] = config.toolbars;
      if (!toolbar) throw new Error("Expected a configured toolbar");
      toolbar.items.push({
        uuid: "b2222222-2222-4222-8222-222222222222",
        icon,
        label,
        linkAttr: { type: "command", commandId },
      });
      files.set(DATA_PATH, JSON.stringify(config));
      return "Added command";
    }
    return "";
  });
  const openUri = jest.fn().mockResolvedValue(undefined);
  const deps: NoteToolbarIntegrationDependencies = {
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path)),
      read: jest.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error(`Missing ${path}`);
        return value;
      }),
    },
    apiVersion: "1.13.1",
    cliAvailable: options?.cliAvailable ?? true,
    commandId: COMMAND_ID,
    configDir: CONFIG_DIR,
    itemStyle: options?.itemStyle ?? "label-and-icon",
    itemTooltip: "Add selection to Pivi input",
    getInstalledPluginVersion: (pluginId) =>
      pluginId === "note-toolbar" && installed ? options?.version ?? "1.31.06" : null,
    isPluginEnabled: (pluginId) => pluginId === "note-toolbar" && installed && enabled,
    openUri,
    runCli,
  };
  return { deps, files, openUri, runCli };
}

describe("Note Toolbar integration", () => {
  it("adds the Pivi command through Note Toolbar's CLI and verifies it", async () => {
    const { deps, runCli } = createHarness();

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "installed",
    });
    expect(runCli).toHaveBeenCalledWith([
      "note-toolbar:add-command",
      `to=${TOOLBAR_ID}`,
      `command=${COMMAND_ID}`,
      "label=Pivi",
      "icon=message-square-plus",
      "tooltip=Add selection to Pivi input",
      "focus",
    ]);
  });

  it("omits the label when adding the icon-only style", async () => {
    const { deps, runCli } = createHarness({ itemStyle: "icon-only" });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "installed",
    });
    expect(runCli).toHaveBeenCalledWith([
      "note-toolbar:add-command",
      `to=${TOOLBAR_ID}`,
      `command=${COMMAND_ID}`,
      "icon=message-square-plus",
      "tooltip=Add selection to Pivi input",
      "focus",
    ]);
  });

  it("does not duplicate an existing command item", async () => {
    const config = createToolbarConfig([
      {
        icon: "message-square-plus",
        label: "Pivi",
        linkAttr: { type: "command", commandId: COMMAND_ID },
      },
    ]);
    const { deps, runCli } = createHarness({ config });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "already-installed",
    });
    expect(runCli).not.toHaveBeenCalled();
  });

  it('uses the official Note Toolbar API to synchronize an existing icon-only item', async () => {
    const itemId = 'b2222222-2222-4222-8222-222222222222';
    const config = createToolbarConfig([{
      uuid: itemId,
      icon: 'message-square-plus',
      label: 'Old label',
      tooltip: 'Old tooltip',
      linkAttr: { type: 'command', commandId: COMMAND_ID },
    }]);
    const { deps, runCli } = createHarness({ config, itemStyle: 'icon-only' });
    const setIcon = jest.fn(async () => undefined);
    const setLabel = jest.fn(async () => undefined);
    const setTooltip = jest.fn(async () => undefined);
    deps.itemTooltip = 'Run /polish in a new Pivi session';
    deps.getItemApi = id => id === itemId ? {
      getIcon: () => 'sparkles',
      getLabel: () => 'Old label',
      getTooltip: () => 'Old tooltip',
      setIcon,
      setLabel,
      setTooltip,
    } : null;

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: 'already-installed',
    });
    expect(setIcon).toHaveBeenCalledWith('message-square-plus');
    expect(setLabel).toHaveBeenCalledWith('');
    expect(setTooltip).toHaveBeenCalledWith('Run /polish in a new Pivi session');
    expect(runCli).not.toHaveBeenCalled();
  });

  it("opens the existing item settings when switching styles", async () => {
    const itemId = "b2222222-2222-4222-8222-222222222222";
    const config = createToolbarConfig([
      {
        uuid: itemId,
        icon: "message-square-plus",
        label: "Pivi",
        linkAttr: { type: "command", commandId: COMMAND_ID },
      },
    ]);
    const { deps, runCli } = createHarness({
      config,
      itemStyle: "icon-only",
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "style-settings-opened",
    });
    expect(runCli).toHaveBeenCalledWith([
      "note-toolbar:settings",
      `item=${itemId}`,
    ]);
  });

  it("opens manual setup when switching styles without CLI access", async () => {
    const config = createToolbarConfig([
      {
        uuid: "b2222222-2222-4222-8222-222222222222",
        icon: "message-square-plus",
        label: "Pivi",
        linkAttr: { type: "command", commandId: COMMAND_ID },
      },
    ]);
    const { deps, openUri, runCli } = createHarness({
      cliAvailable: false,
      config,
      itemStyle: "icon-only",
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "manual-setup-opened",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://note-toolbar?settings=true",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("reports a missing Note Toolbar without invoking CLI or opening a URI", async () => {
    const { deps, openUri, runCli } = createHarness({
      installed: false,
      enabled: false,
      config: null,
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "not-installed",
    });
    expect(openUri).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("opens the plugin page when Note Toolbar is installed but cannot be enabled", async () => {
    const { deps, openUri, runCli } = createHarness({
      enabled: false,
      cliAvailable: false,
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "plugin-activation-opened",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://show-plugin?id=note-toolbar",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("detects installation through the in-memory plugin registry", () => {
    const installed = createHarness();
    const missing = createHarness({ installed: false });

    expect(isNoteToolbarInstalled(installed.deps.getInstalledPluginVersion)).toBe(true);
    expect(isNoteToolbarInstalled(missing.deps.getInstalledPluginVersion)).toBe(false);
  });

  it("enables an installed plugin before adding the command", async () => {
    const { deps, runCli } = createHarness({ enabled: false });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "installed",
    });
    const firstInvocation = runCli.mock.calls[0];
    if (!firstInvocation) throw new Error("Expected an enable CLI call");
    const [firstCliCall] = firstInvocation;
    expect(firstCliCall).toEqual([
      "plugin:enable",
      "id=note-toolbar",
      "filter=community",
    ]);
  });

  it("opens Note Toolbar settings when no selected-text toolbar is configured", async () => {
    const { deps, openUri, runCli } = createHarness({
      config: { version: 20260703.1, textToolbar: null, toolbars: [] },
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "needs-text-toolbar",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://note-toolbar?settings=true",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("rejects a selected-text toolbar reference that points nowhere", async () => {
    const { deps, openUri, runCli } = createHarness({
      config: { textToolbar: TOOLBAR_ID, toolbars: [] },
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "invalid-config",
    });
    expect(openUri).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("opens manual setup when CLI cannot add the command", async () => {
    const { deps, openUri, runCli } = createHarness({ cliAvailable: false });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "manual-setup-opened",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://note-toolbar?settings=true",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("opens the marketplace for an unsupported Note Toolbar version", async () => {
    const { deps, openUri, runCli } = createHarness({ version: "1.31.05" });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "unsupported-note-toolbar-version",
      version: "1.31.05",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://show-plugin?id=note-toolbar",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("reports a failed post-install verification", async () => {
    const { deps, runCli } = createHarness();
    runCli.mockImplementation(async () => "Added without saving");

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "verification-failed",
    });
  });

  it("reports malformed JSON without overwriting third-party configuration", async () => {
    const { deps, files, runCli } = createHarness();
    files.set(DATA_PATH, "{not-json");

    const result = await setupNoteToolbarIntegration(deps);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("JSON");
    expect(files.get(DATA_PATH)).toBe("{not-json");
    expect(runCli).not.toHaveBeenCalled();
  });
});

describe("plugin registry probes", () => {
  it("reads the installed version from the in-memory registry", () => {
    const app = {
      plugins: { manifests: { "note-toolbar": { version: "1.31.06" } } },
    } as unknown as App;

    expect(getInstalledPluginVersion(app, "note-toolbar")).toBe("1.31.06");
    expect(getInstalledPluginVersion(app, "missing-plugin")).toBeNull();
  });

  it("reports a registry manifest without a string version as empty", () => {
    const app = {
      plugins: { manifests: { "note-toolbar": {} } },
    } as unknown as App;

    expect(getInstalledPluginVersion(app, "note-toolbar")).toBe("");
  });

  it("treats a missing or throwing registry as not installed", () => {
    expect(getInstalledPluginVersion({} as unknown as App, "note-toolbar")).toBeNull();
    const throwing = {
      get plugins() {
        throw new Error("registry unavailable");
      },
    } as unknown as App;
    expect(getInstalledPluginVersion(throwing, "note-toolbar")).toBeNull();
  });

  it("reads enabled state from the in-memory registry", () => {
    const app = {
      plugins: { enabledPlugins: new Set(["note-toolbar"]) },
    } as unknown as App;

    expect(isPluginEnabled(app, "note-toolbar")).toBe(true);
    expect(isPluginEnabled(app, "other-plugin")).toBe(false);
    expect(isPluginEnabled({} as unknown as App, "note-toolbar")).toBe(false);
  });
});
