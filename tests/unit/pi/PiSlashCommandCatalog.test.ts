import {
  parseMarkdownTemplate,
  PiSlashCommandCatalog,
} from '@/app/workspace/PiSlashCommandCatalog';
import type { FileStore } from "@pivi/obsidian-host";
import type PiviPlugin from "@/main";
import { TAbstractFile } from "obsidian";

describe("parseMarkdownTemplate", () => {
  it("correctly parses templates with valid frontmatter", () => {
    const template = `---
description: Critique the code.
argumentHint: code
---
Please review this code:
{{selected_text}}`;

    const { frontmatter, body } = parseMarkdownTemplate(template);
    expect(frontmatter).toEqual({
      description: "Critique the code.",
      argumentHint: "code",
    });
    expect(body).toBe("Please review this code:\n{{selected_text}}");
  });

  it("handles templates without frontmatter", () => {
    const template = "Just normal text: {{selected_text}}";
    const { frontmatter, body } = parseMarkdownTemplate(template);
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just normal text: {{selected_text}}");
  });

  it("trims surrounding quotes from frontmatter values", () => {
    const template = `---
description: "Review this text"
argumentHint: 'text'
---
Review: {{selected_text}}`;
    const { frontmatter, body } = parseMarkdownTemplate(template);
    expect(frontmatter).toEqual({
      description: "Review this text",
      argumentHint: "text",
    });
    expect(body).toBe("Review: {{selected_text}}");
  });
});

describe("PiSlashCommandCatalog", () => {
  let mockPlugin: jest.Mocked<PiviPlugin>;
  let mockAdapter: jest.Mocked<FileStore>;
  let catalog: PiSlashCommandCatalog;

  beforeEach(() => {
    mockPlugin = {
      registerEvent: jest.fn(),
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

    catalog = new PiSlashCommandCatalog(mockPlugin, mockAdapter);
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
    const entries = await catalog.listVaultEntries();

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
      scope: "vault",
      source: "user",
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
      persistenceKey: "vault:explain",
    });
  });

  it("loads legacy templates when no command file exists", async () => {
    mockAdapter.listFiles.mockImplementation(async (folder: string) => {
      if (folder === ".pivi/templates") {
        return [".pivi/templates/legacy.md"];
      }
      return [];
    });

    await catalog.refresh();
    const entries = await catalog.listVaultEntries();

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

  it("saves custom vault templates to files", async () => {
    const newEntry = {
      id: "critique",
      kind: "command" as const,
      name: "critique",
      description: "Critique text",
      argumentHint: "text",
      content: "Critique this: {{selected_text}}",
      scope: "vault" as const,
      source: "user" as const,
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
    };

    await catalog.saveVaultEntry(newEntry);
    expect(mockAdapter.write).toHaveBeenCalledWith(
      ".pivi/commands/critique.md",
      expect.stringContaining("description: Critique text"),
    );
  });

  it("deletes custom vault templates from files", async () => {
    const entryToDelete = {
      id: "explain",
      kind: "command" as const,
      name: "explain",
      content: "",
      scope: "vault" as const,
      source: "user" as const,
      isEditable: true,
      isDeletable: true,
      displayPrefix: "/",
      insertPrefix: "/",
    };

    await catalog.deleteVaultEntry(entryToDelete);
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
