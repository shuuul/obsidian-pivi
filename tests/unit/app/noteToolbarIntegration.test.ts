import {
  setupNoteToolbarIntegration,
  type NoteToolbarIntegrationDependencies,
  type NoteToolbarItemStyle,
} from "@/app/noteToolbarIntegration";

const CONFIG_DIR = ".config";
const MANIFEST_PATH = `${CONFIG_DIR}/plugins/note-toolbar/manifest.json`;
const DATA_PATH = `${CONFIG_DIR}/plugins/note-toolbar/data.json`;
const ENABLED_PATH = `${CONFIG_DIR}/community-plugins.json`;
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
  if (installed) {
    files.set(
      MANIFEST_PATH,
      JSON.stringify({ id: "note-toolbar", version: options?.version ?? "1.31.06" }),
    );
  }
  if (options?.enabled ?? true) {
    files.set(ENABLED_PATH, JSON.stringify(["pivi", "note-toolbar"]));
  } else {
    files.set(ENABLED_PATH, JSON.stringify(["pivi"]));
  }
  if (options?.config !== null) {
    files.set(DATA_PATH, JSON.stringify(options?.config ?? createToolbarConfig()));
  }

  const runCli = jest.fn(async (args: string[]): Promise<string> => {
    if (args[0] === "plugin:install") {
      files.set(
        MANIFEST_PATH,
        JSON.stringify({ id: "note-toolbar", version: "1.31.06" }),
      );
      files.set(ENABLED_PATH, JSON.stringify(["pivi", "note-toolbar"]));
      return "Installed and enabled note-toolbar";
    }
    if (args[0] === "plugin:enable") {
      files.set(ENABLED_PATH, JSON.stringify(["pivi", "note-toolbar"]));
      return "Enabled note-toolbar";
    }
    if (args[0] === "note-toolbar:add-command") {
      const config = JSON.parse(files.get(DATA_PATH) ?? "{}") as ReturnType<
        typeof createToolbarConfig
      >;
      const label = args.find((arg) => arg.startsWith("label="))?.slice(6) ?? "";
      const icon = args.find((arg) => arg.startsWith("icon="))?.slice(5) ?? "";
      const [toolbar] = config.toolbars;
      if (!toolbar) throw new Error("Expected a configured toolbar");
      toolbar.items.push({
        uuid: "b2222222-2222-4222-8222-222222222222",
        icon,
        label,
        linkAttr: { type: "command", commandId: COMMAND_ID },
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

  it("installs and enables Note Toolbar when it is missing", async () => {
    const { deps, files, openUri, runCli } = createHarness({
      installed: false,
      enabled: false,
      config: null,
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "needs-text-toolbar",
      pluginInstalled: true,
      pluginEnabled: true,
    });
    expect(runCli).toHaveBeenCalledWith([
      "plugin:install",
      "id=note-toolbar",
      "enable",
    ]);
    expect(files.has(MANIFEST_PATH)).toBe(true);
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://note-toolbar?settings=true",
    );
  });

  it("opens the marketplace when Note Toolbar is missing and CLI is unavailable", async () => {
    const { deps, openUri, runCli } = createHarness({
      installed: false,
      enabled: false,
      config: null,
      cliAvailable: false,
    });

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "plugin-installation-opened",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://show-plugin?id=note-toolbar",
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it("opens the marketplace when automatic installation fails", async () => {
    const { deps, openUri, runCli } = createHarness({
      installed: false,
      enabled: false,
      config: null,
    });
    runCli.mockRejectedValue(new Error("CLI unavailable"));

    await expect(setupNoteToolbarIntegration(deps)).resolves.toEqual({
      status: "plugin-installation-opened",
    });
    expect(openUri).toHaveBeenCalledWith(
      "obsidian://show-plugin?id=note-toolbar",
    );
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
      pluginInstalled: false,
      pluginEnabled: true,
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
