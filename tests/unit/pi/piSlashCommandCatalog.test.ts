import { parseSlashCommandContent } from '@pivi/pivi-agent-core/skills/slashCommand';
import { PiSlashCommandCatalog } from '@/app/workspace/PiSlashCommandCatalog';
import type { FileStore } from "@pivi/pivi-agent-core/ports";
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

    expect(mockAdapter.ensureFolder).toHaveBeenCalledWith(".pivi/commands");
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

    await catalog.saveWorkspaceEntry(newEntry);
    expect(mockAdapter.write).toHaveBeenCalledWith(
      ".pivi/commands/critique.md",
      expect.stringMatching(/description: Critique text[\s\S]*argument-hint: text[\s\S]*integration-key: generated-key/),
    );
  });

  it("deletes custom vault templates from files", async () => {
    const entryToDelete = {
      id: "explain",
      kind: "command" as const,
      name: "explain",
      content: "",
      scope: "workspace" as const,
      source: "user" as const,
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
    };

    await catalog.deleteWorkspaceEntry(entryToDelete);
    expect(mockAdapter.exists).toHaveBeenCalledWith(
      ".pivi/commands/explain.md",
    );
    expect(mockAdapter.exists).toHaveBeenCalledWith(
      ".pivi/templates/explain.md",
    );
    expect(mockAdapter.delete).toHaveBeenCalledWith(
      ".pivi/commands/explain.md",
    );
    expect(mockAdapter.delete).toHaveBeenCalledWith(
      ".pivi/templates/explain.md",
    );
  });
});
