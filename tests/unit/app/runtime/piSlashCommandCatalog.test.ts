import { parseSlashCommandContent } from '@pivi/agent/skills/slashCommand';
import { RESERVED_COMMAND_IDS } from '@pivi/agent/skills/commands/slashCommandIds';
import { PiSlashCommandCatalog } from '@/app/runtime/PiSlashCommandCatalog';
import type { FileStore } from "@pivi/agent/ports";
import type PiviPlugin from "@/main";
import { TAbstractFile } from "obsidian";

describe("parseSlashCommandContent", () => {
  it("correctly parses templates with valid frontmatter", () => {
    const template = `---
description: Critique the code.
argumentHint: code
---
Please review this code:
{{selected_text}}`;

    const parsed = parseSlashCommandContent(template);
    expect(parsed.description).toBe("Critique the code.");
    expect(parsed.argumentHint).toBe("code");
    expect(parsed.promptContent).toBe("Please review this code:\n{{selected_text}}");
  });

  it("handles templates without frontmatter", () => {
    const template = "Just normal text: {{selected_text}}";
    const parsed = parseSlashCommandContent(template);
    expect(parsed.promptContent).toBe("Just normal text: {{selected_text}}");
  });

  it("trims surrounding quotes from frontmatter values", () => {
    const template = `---
description: "Review this text"
argumentHint: 'text'
---
Review: {{selected_text}}`;
    const parsed = parseSlashCommandContent(template);
    expect(parsed.description).toBe("Review this text");
    expect(parsed.argumentHint).toBe("text");
    expect(parsed.promptContent).toBe("Review: {{selected_text}}");
  });
});

describe("PiSlashCommandCatalog", () => {
  let mockPlugin: jest.Mocked<PiviPlugin>;
  let mockAdapter: jest.Mocked<FileStore>;
  let catalog: PiSlashCommandCatalog;

  beforeEach(() => {
    mockPlugin = {
      registerEvent: jest.fn(),
      settings: { workspaceCommandOrder: [] },
      app: {
        vault: {
          on: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PiviPlugin>;

    mockAdapter = {
      ensureFolder: jest.fn().mockResolvedValue(undefined),
      listFiles: jest.fn(async (folder: string) => {
        if (folder === ".pivi/commands") {
          return [".pivi/commands/explain.md"];
        }
        return [];
      }),
      listFolders: jest.fn(async () => []),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      read: jest.fn(
        async () => `---
description: Explain this code.
argumentHint: code
---
Explain this: {{selected_text}}`,
      ),
      write: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStore>;

    catalog = new PiSlashCommandCatalog(mockPlugin, mockAdapter, {
      createIntegrationKey: () => 'generated-key',
    });
  });

  it("registers vault events during instantiation", () => {
    expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(4);
    expect(mockPlugin.app.vault.on).toHaveBeenCalledWith(
      "create",
      expect.any(Function),
    );
    expect(mockPlugin.app.vault.on).toHaveBeenCalledWith(
      "modify",
      expect.any(Function),
    );
    expect(mockPlugin.app.vault.on).toHaveBeenCalledWith(
      "delete",
      expect.any(Function),
    );
    expect(mockPlugin.app.vault.on).toHaveBeenCalledWith(
      "rename",
      expect.any(Function),
    );
  });

  it("loads and refreshes vault templates successfully", async () => {
    await catalog.refresh();
    const entries = await catalog.listWorkspaceEntries();

    expect(mockAdapter.ensureFolder).not.toHaveBeenCalled();
    expect(mockAdapter.listFiles).toHaveBeenCalledWith(".pivi/templates");
    expect(mockAdapter.listFiles).toHaveBeenCalledWith(".pivi/commands");
    expect(mockAdapter.read).toHaveBeenCalledWith(".pivi/commands/explain.md");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "explain",
      kind: "command",
      name: "explain",
      description: "Explain this code.",
      content: "Explain this: {{selected_text}}",
      argumentHint: "code",
      integrationKey: "generated-key",
      scope: "workspace",
      source: "user",
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
      persistenceKey: "vault:explain",
    });
  });

  it("orders workspace entries by workspaceCommandOrder and keeps unlisted commands last", async () => {
    mockPlugin.settings.workspaceCommandOrder = ["gamma", "alpha"];
    mockAdapter.listFiles = jest.fn(async (folder: string) =>
      folder === ".pivi/commands"
        ? [
            ".pivi/commands/beta.md",
            ".pivi/commands/alpha.md",
            ".pivi/commands/gamma.md",
          ]
        : [],
    );

    await catalog.refresh();
    const entries = await catalog.listWorkspaceEntries();

    expect(entries.map((entry) => entry.id)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("keeps existing workspace commands with legacy non-slug ids visible", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/review notes.md": COMMAND_BYTES,
      ".pivi/commands/复盘.md": COMMAND_BYTES,
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });

    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    expect(snapshot.entries.map(entry => entry.id)).toEqual(["review notes", "复盘"]);
  });

  it("updates workspace command order when renaming a command", async () => {
    mockPlugin.settings.workspaceCommandOrder = ["first", "second"];
    mockPlugin.saveSettings = jest.fn().mockResolvedValue(undefined);
    const store = createMemoryCommandStore({
      ".pivi/commands/first.md": COMMAND_BYTES,
      ".pivi/commands/second.md": COMMAND_BYTES,
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });

    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    const first = snapshot.entries.find(entry => entry.id === "first")!;
    await memoryCatalog.renameWorkspaceEntry(
      first,
      { ...first, id: "renamed", name: "renamed" },
      snapshot.catalogRevision,
    );

    expect(mockPlugin.settings.workspaceCommandOrder).toEqual(["renamed", "second"]);
    expect((await memoryCatalog.listWorkspaceEntries()).map(entry => entry.id)).toEqual(["renamed", "second"]);
  });

  it("rolls back the renamed file and order when order persistence fails", async () => {
    mockPlugin.settings.workspaceCommandOrder = ["first", "second"];
    mockPlugin.saveSettings = jest.fn().mockRejectedValue(new Error("settings unavailable"));
    const store = createMemoryCommandStore({
      ".pivi/commands/first.md": COMMAND_BYTES,
      ".pivi/commands/second.md": COMMAND_BYTES,
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });

    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    const first = snapshot.entries.find(entry => entry.id === "first")!;
    await expect(memoryCatalog.renameWorkspaceEntry(
      first,
      { ...first, id: "renamed", name: "renamed" },
      snapshot.catalogRevision,
    )).rejects.toThrow("settings unavailable");

    expect(mockPlugin.settings.workspaceCommandOrder).toEqual(["first", "second"]);
    expect(store.files.has(".pivi/commands/first.md")).toBe(true);
    expect(store.files.has(".pivi/commands/renamed.md")).toBe(false);
  });

  it("loads legacy templates when no command file exists", async () => {
    mockAdapter.listFiles.mockImplementation(async (folder: string) => {
      if (folder === ".pivi/templates") {
        return [".pivi/templates/legacy.md"];
      }
      return [];
    });

    await catalog.refresh();
    const entries = await catalog.listWorkspaceEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "legacy",
      persistenceKey: "legacy-template:legacy",
    });
  });

  it("correctly maps and sets runtime commands", async () => {
    catalog.setRuntimeCommands([
      {
        id: "sdk:review",
        name: "review",
        description: "Review code",
        content: "Review: {{selected_text}}",
        source: "sdk",
      },
    ]);

    const dropdownEntries = await catalog.listDropdownEntries({
      includeBuiltIns: true,
    });
    const runtimeEntry = dropdownEntries.find((e) => e.scope === "runtime");

    expect(runtimeEntry).toBeDefined();
    expect(runtimeEntry?.name).toBe("review");
    expect(runtimeEntry?.description).toBe("Review code");
    expect(runtimeEntry?.content).toBe("Review: {{selected_text}}");
  });

  it("does not include the create-command slash entry", async () => {
    const dropdownEntries = await catalog.listDropdownEntries({
      includeBuiltIns: true,
    });

    expect(dropdownEntries.map((entry) => entry.id)).not.toContain("create-command");
  });

  it("includes compact as a non-editable built-in command", async () => {
    const dropdownEntries = await catalog.listDropdownEntries({
      includeBuiltIns: true,
    });

    expect(dropdownEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "compact",
        content: "/compact",
        scope: "builtin",
        source: "builtin",
        isEditable: false,
        isDeletable: false,
      }),
    ]));
  });

  it("includes new as a non-editable built-in command", async () => {
    const dropdownEntries = await catalog.listDropdownEntries({
      includeBuiltIns: true,
    });

    expect(dropdownEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "new",
        name: "new",
        content: "",
        scope: "builtin",
        source: "builtin",
        isEditable: false,
        isDeletable: false,
      }),
    ]));
  });

  it('shadows reserved workspace files without reading or mutating their bytes', async () => {
    const reservedBytes = new Map([...RESERVED_COMMAND_IDS].map(id => [
      `.pivi/commands/${id}.md`,
      `legacy bytes for ${id}`,
    ]));
    const store = createMemoryCommandStore(Object.fromEntries(reservedBytes));
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      isImageGenerationEnabled: () => true,
      createIntegrationKey: () => 'generated-key',
    });

    await memoryCatalog.prepareWorkspace();
    expect(await memoryCatalog.listWorkspaceEntries()).toEqual([]);
    const dropdown = await memoryCatalog.listDropdownEntries({ includeBuiltIns: true });
    for (const [path, bytes] of reservedBytes) {
      expect(store.files.get(path)).toBe(bytes);
      expect(dropdown.filter(entry => entry.id === commandId(path))).toHaveLength(1);
    }
  });

  it.each([...RESERVED_COMMAND_IDS])('rejects reserved /%s from Settings and Agent writes', async (id) => {
    const snapshot = await catalog.getWorkspaceSnapshot();
    const entry = { ...snapshot.entries[0]!, id, name: id };

    await expect(catalog.saveWorkspaceEntry(entry, snapshot.catalogRevision))
      .rejects.toMatchObject({ code: 'not_eligible' });
    await expect(catalog.renameWorkspaceEntry(snapshot.entries[0]!, entry, snapshot.catalogRevision))
      .rejects.toMatchObject({ code: 'not_eligible' });
    await expect(catalog.executeCommands({
      action: 'upsert', id, content: 'must not write', catalogRevision: snapshot.catalogRevision,
    })).rejects.toMatchObject({ code: 'not_eligible' });
    await expect(catalog.executeCommands({
      action: 'remove', id, catalogRevision: snapshot.catalogRevision,
    })).rejects.toMatchObject({ code: 'not_eligible' });
    expect(mockAdapter.write).not.toHaveBeenCalled();
    expect(mockAdapter.delete).not.toHaveBeenCalled();
  });

  it("adds the image generation tool only when it is enabled", async () => {
    const imageCatalog = new PiSlashCommandCatalog(mockPlugin, mockAdapter, {
      isImageGenerationEnabled: () => true,
      createIntegrationKey: () => 'generated-key',
    });

    const hiddenEntries = await catalog.listDropdownEntries({
      includeBuiltIns: true,
    });
    const imageEntries = await imageCatalog.listDropdownEntries({
      includeBuiltIns: true,
    });

    expect(hiddenEntries.map((entry) => entry.id)).not.toContain("generate-image");
    expect(imageEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "generate-image",
        kind: "tool",
        toolName: "obsidian_generate_image",
        content: "",
      }),
    ]));
    expect(imageEntries.find((entry) => entry.id === "generate-image")?.argumentHint).toBeUndefined();
  });

  it("saves custom vault templates to files", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const newEntry = {
      id: "critique",
      kind: "command" as const,
      name: "critique",
      description: "Critique text",
      argumentHint: "text",
      content: "Critique this: {{selected_text}}",
      scope: "workspace" as const,
      source: "user" as const,
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
    };

    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    await memoryCatalog.saveWorkspaceEntry(newEntry, snapshot.catalogRevision);
    expect(store.files.get('.pivi/commands/critique.md')).toEqual(
      expect.stringMatching(/description: Critique text[\s\S]*argument-hint: text[\s\S]*integration-key: generated-key/),
    );
  });

  it("keeps list/get refreshes read-only and migrates keyless identity only during preparation", async () => {
    let bytes = `---\ndescription: Explain\n---\nFirst body`;
    mockAdapter.read.mockImplementation(async () => bytes);
    mockAdapter.write.mockImplementation(async (_path, content) => { bytes = content; });

    await catalog.executeCommands({ action: 'list' });
    await catalog.executeCommands({ action: 'get', id: 'explain' });
    expect(mockAdapter.write).not.toHaveBeenCalled();
    expect(mockAdapter.ensureFolder).not.toHaveBeenCalled();

    await catalog.prepareWorkspace();
    expect(bytes).toContain('integration-key: generated-key');
    const restarted = new PiSlashCommandCatalog(mockPlugin, mockAdapter, {
      createIntegrationKey: () => 'different-key',
    });
    const entries = await restarted.listWorkspaceEntries();
    expect(entries[0]?.integrationKey).toBe('generated-key');
  });

  it("changes revision for authoritative prompt bytes and persisted order", async () => {
    let bytes = `---\nintegration-key: stable-key\ndescription: Explain\n---\nFirst body`;
    mockAdapter.read.mockImplementation(async () => bytes);
    const first = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    bytes = bytes.replace('First body', 'Second body');
    const bodyEdit = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    expect(bodyEdit.catalogRevision).not.toBe(first.catalogRevision);
    mockPlugin.settings.workspaceCommandOrder = ['explain'];
    const reordered = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    expect(reordered.catalogRevision).not.toBe(bodyEdit.catalogRevision);
  });

  it("keeps the revision for unchanged scans and advances it for every distinct fingerprint", async () => {
    let bytes = `---\nintegration-key: stable-key\n---\nFirst body`;
    mockAdapter.read.mockImplementation(async () => bytes);
    const first = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    const unchanged = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    expect(unchanged.catalogRevision).toBe(first.catalogRevision);

    bytes = bytes.replace('First body', 'Second body');
    const second = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    bytes = bytes.replace('Second body', 'Third body');
    const third = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    expect(second.catalogRevision).toBe(first.catalogRevision + 1);
    expect(third.catalogRevision).toBe(second.catalogRevision + 1);
  });

  it.each(['Settings', 'Agent'])('%s upserts preserve leading and trailing prompt whitespace bytes', async (surface) => {
    const store = createMemoryCommandStore({ '.pivi/commands/explain.md': COMMAND_BYTES });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const content = '\n  Keep these prompt bytes.  \n\n';
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();

    if (surface === 'Settings') {
      await memoryCatalog.saveWorkspaceEntry({ ...snapshot.entries[0]!, content }, snapshot.catalogRevision);
    } else {
      await memoryCatalog.executeCommands({
        action: 'upsert', id: 'explain', content, catalogRevision: snapshot.catalogRevision,
      });
    }

    const persisted = store.files.get('.pivi/commands/explain.md')!;
    expect(persisted.endsWith(`---\n${content}`)).toBe(true);
    expect(parseSlashCommandContent(persisted).promptContent).toBe(content);
  });

  it('rejects an approved Agent plan after a watcher-visible change without writing', async () => {
    const store = createMemoryCommandStore({ '.pivi/commands/explain.md': COMMAND_BYTES });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    const plan = await memoryCatalog.planCommands({
      action: 'upsert', id: 'explain', content: 'Approved body', catalogRevision: snapshot.catalogRevision,
    });

    store.files.set('.pivi/commands/explain.md', COMMAND_BYTES.replace('Explain this:', 'Watcher edit:'));
    (store.adapter.write as jest.Mock).mockClear();
    await expect(memoryCatalog.commitCommands(plan, snapshot.catalogRevision))
      .rejects.toMatchObject({ code: 'state_changed' });
    expect(store.adapter.write).not.toHaveBeenCalled();
    expect(store.files.get('.pivi/commands/explain.md')).toContain('Watcher edit:');
  });

  it("rejects stale upsert, remove, and move revisions without overwriting newer bytes", async () => {
    let bytes = `---\nintegration-key: stable-key\ndescription: Explain\n---\nOriginal`;
    mockAdapter.read.mockImplementation(async () => bytes);
    const listed = await catalog.executeCommands({ action: 'list' }) as { catalogRevision: number };
    bytes = bytes.replace('Original', 'Manual newer');

    await expect(catalog.executeCommands({ action: 'upsert', id: 'explain', content: 'Agent',
      catalogRevision: listed.catalogRevision })).rejects.toMatchObject({ code: 'state_changed' });
    await expect(catalog.executeCommands({ action: 'remove', id: 'explain',
      catalogRevision: listed.catalogRevision })).rejects.toMatchObject({ code: 'state_changed' });
    await expect(catalog.executeCommands({ action: 'move', id: 'explain', beforeId: 'other',
      catalogRevision: listed.catalogRevision })).rejects.toMatchObject({ code: 'state_changed' });
    expect(bytes).toContain('Manual newer');
    expect(mockAdapter.delete).not.toHaveBeenCalled();
  });

  it('rejects a stale Settings snapshot instead of overwriting a newer Agent edit', async () => {
    let bytes = `---\nintegration-key: stable-key\ndescription: Explain\n---\nOriginal`;
    mockAdapter.read.mockImplementation(async () => bytes);
    const snapshot = await catalog.getWorkspaceSnapshot();
    bytes = bytes.replace('Original', 'Agent newer');

    await expect(catalog.saveWorkspaceEntry({
      ...snapshot.entries[0]!,
      content: 'Stale Settings edit',
    }, snapshot.catalogRevision)).rejects.toMatchObject({ code: 'state_changed' });

    expect(bytes).toContain('Agent newer');
    expect(mockAdapter.write).not.toHaveBeenCalled();
  });

  it('does not write when an Agent mutation is aborted while waiting for the command queue', async () => {
    let release!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    let firstList = true;
    mockAdapter.listFiles.mockImplementation(async (folder: string) => {
      if (firstList) {
        firstList = false;
        markEntered();
        await new Promise<void>(resolve => { release = resolve; });
      }
      return folder === '.pivi/commands' ? ['.pivi/commands/explain.md'] : [];
    });
    const blocker = catalog.refresh();
    await entered;
    const controller = new AbortController();
    const mutation = catalog.executeCommands({
      action: 'upsert', id: 'explain', content: 'Must not save', catalogRevision: 0,
    }, controller.signal);
    controller.abort();
    release();
    await blocker;

    await expect(mutation).rejects.toMatchObject({ code: 'cancelled' });
    expect(mockAdapter.write).not.toHaveBeenCalled();
  });

  it("atomically stages and deletes canonical and legacy command files", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
      ".pivi/templates/explain.md": COMMAND_BYTES,
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();
    await memoryCatalog.deleteWorkspaceEntry(snapshot.entries[0]!, snapshot.catalogRevision);

    expect(store.files.has(".pivi/commands/explain.md")).toBe(false);
    expect(store.files.has(".pivi/templates/explain.md")).toBe(false);
    expect([...store.files.keys()].some(path => path.startsWith(".pivi/.commands-removal-"))).toBe(false);
    expect(await memoryCatalog.listWorkspaceEntries()).toEqual([]);
  });

  it("restores the canonical file when staging the legacy file fails", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
      ".pivi/templates/explain.md": COMMAND_BYTES,
    });
    const originalRename = store.adapter.rename;
    store.adapter.rename = jest.fn(async (from, to) => {
      if (from === ".pivi/templates/explain.md") throw new Error('legacy staging failed');
      return originalRename(from, to);
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();

    await expect(memoryCatalog.deleteWorkspaceEntry(snapshot.entries[0]!, snapshot.catalogRevision))
      .rejects.toThrow('legacy staging failed');

    expect(store.files.get(".pivi/commands/explain.md")).toBe(COMMAND_BYTES);
    expect(store.files.get(".pivi/templates/explain.md")).toBe(COMMAND_BYTES);
    expect([...store.files.keys()].some(path => path.startsWith(".pivi/.commands-removal-"))).toBe(false);
  });

  it("retains the recovery root when restore fails after a second-stage staging error", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
      ".pivi/templates/explain.md": COMMAND_BYTES,
    });
    const originalRename = store.adapter.rename;
    store.adapter.rename = jest.fn(async (from, to) => {
      if (from === ".pivi/templates/explain.md") throw new Error('legacy staging failed');
      if (String(from).endsWith('/canonical.md') && to === ".pivi/commands/explain.md") {
        throw new Error('restore failed');
      }
      return originalRename(from, to);
    });
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();

    await expect(memoryCatalog.deleteWorkspaceEntry(snapshot.entries[0]!, snapshot.catalogRevision))
      .rejects.toThrow('restore failed');

    const roots = [...store.folders].filter(path => path.startsWith(".pivi/.commands-removal-"));
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(store.files.has(`${root}/canonical.md`)).toBe(true);
    expect(store.files.has(`${root}/transaction.json`)).toBe(true);
    expect(JSON.parse(store.files.get(`${root}/transaction.json`)!).phase).toBe('staged');
  });

  it("recovers an incomplete staged removal before catalog refresh", async () => {
    const root = ".pivi/.commands-removal-leftover";
    const store = createMemoryCommandStore({
      [`${root}/canonical.md`]: COMMAND_BYTES,
      [`${root}/transaction.json`]: JSON.stringify({
        version: 1,
        id: "explain",
        phase: "staged",
        staged: [{ originalPath: ".pivi/commands/explain.md", backupName: "canonical.md" }],
      }, null, 2),
    });
    store.folders.add(root);
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });

    const entries = await memoryCatalog.listWorkspaceEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("explain");
    expect(store.files.get(".pivi/commands/explain.md")).toBe(COMMAND_BYTES);
    expect(store.folders.has(root)).toBe(false);
  });

  it("surfaces Settings cleanup failure after a durable removal", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
    });
    store.adapter.deleteFolder = jest.fn(async (_path: string) => undefined);
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const snapshot = await memoryCatalog.getWorkspaceSnapshot();

    await expect(memoryCatalog.deleteWorkspaceEntry(snapshot.entries[0]!, snapshot.catalogRevision))
      .resolves.toEqual({
        saved: true,
        refreshed: false,
        warnings: ['Command was removed, but transaction cleanup failed.'],
      });

    expect(store.files.has(".pivi/commands/explain.md")).toBe(false);
    expect(await memoryCatalog.listWorkspaceEntries()).toEqual([]);
    expect([...store.folders].some(path => path.startsWith(".pivi/.commands-removal-"))).toBe(true);
  });

  it("surfaces Agent cleanup failure without undoing a durable removal", async () => {
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
    });
    store.adapter.deleteFolder = jest.fn(async (_path: string) => undefined);
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });
    const listed = await memoryCatalog.executeCommands({ action: 'list' }) as { catalogRevision: number };

    const result = await memoryCatalog.executeCommands({
      action: 'remove',
      id: 'explain',
      catalogRevision: listed.catalogRevision,
    }) as {
      saved: boolean;
      refreshed: boolean;
      warnings?: string[];
      refreshFailures?: Array<{ target: string; message: string }>;
    };

    expect(result.saved).toBe(true);
    expect(result.refreshed).toBe(false);
    expect(result.warnings).toEqual(['Command was removed, but transaction cleanup failed.']);
    expect(result.refreshFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'commands:cleanup' }),
    ]));
    expect(store.files.has(".pivi/commands/explain.md")).toBe(false);
  });

  it("does not load removal artifacts as commands and ignores them in the vault watcher", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    (mockPlugin.app.vault.on as jest.Mock).mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return event;
    });
    const store = createMemoryCommandStore({
      ".pivi/commands/explain.md": COMMAND_BYTES,
      ".pivi/.commands-removal-x/canonical.md": COMMAND_BYTES,
      ".pivi/commands/explain.md.remove-stale": COMMAND_BYTES,
    });
    store.folders.add(".pivi/.commands-removal-x");
    const memoryCatalog = new PiSlashCommandCatalog(mockPlugin, store.adapter, {
      createIntegrationKey: () => 'generated-key',
    });

    const entries = await memoryCatalog.listWorkspaceEntries();
    expect(entries.map(entry => entry.id)).toEqual(["explain"]);

    const createHandler = handlers.get("create");
    expect(createHandler).toBeDefined();
    const listCallsBefore = (store.adapter.listFiles as jest.Mock).mock.calls.length;
    createHandler?.({ path: ".pivi/.commands-removal-x/canonical.md" });
    createHandler?.({ path: ".pivi/commands/explain.md.remove-stale" });
    await Promise.resolve();
    expect((store.adapter.listFiles as jest.Mock).mock.calls.length).toBe(listCallsBefore);
  });
});

const COMMAND_BYTES = `---
description: Explain this code.
argumentHint: code
integration-key: generated-key
---
Explain this: {{selected_text}}`;

function commandId(path: string): string {
  return path.split('/').at(-1)!.slice(0, -3);
}

function createMemoryCommandStore(initial: Record<string, string>): {
  files: Map<string, string>;
  folders: Set<string>;
  adapter: jest.Mocked<FileStore>;
} {
  const files = new Map(Object.entries(initial));
  const folders = new Set<string>([".pivi", ".pivi/commands", ".pivi/templates"]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    let current = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = current ? `${current}/${parts[index]}` : parts[index]!;
      folders.add(current);
    }
  }

  const adapter = {
    ensureFolder: jest.fn(async (folder: string) => {
      folders.add(folder.replace(/\/+$/, ""));
    }),
    listFiles: jest.fn(async (folder: string) => {
      const prefix = `${folder.replace(/\/+$/, "")}/`;
      return [...files.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
    }),
    listFolders: jest.fn(async (folder: string) => {
      const normalized = folder.replace(/\/+$/, "");
      const prefix = `${normalized}/`;
      return [...folders].filter(path => {
        if (!path.startsWith(prefix)) return false;
        return !path.slice(prefix.length).includes("/");
      });
    }),
    read: jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    }),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent) folders.add(parent);
    }),
    exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
    delete: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    deleteFolder: jest.fn(async (path: string) => {
      const normalized = path.replace(/\/+$/, "");
      const prefix = `${normalized}/`;
      if ([...files.keys()].some(file => file.startsWith(prefix))) return;
      if ([...folders].some(folder => folder !== normalized && folder.startsWith(prefix))) return;
      folders.delete(normalized);
    }),
    rename: jest.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, content);
      const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
      if (parent) folders.add(parent);
    }),
  } as unknown as jest.Mocked<FileStore>;

  return { files, folders, adapter };
}
