import type { TAbstractFile } from "obsidian";

import type PiviPlugin from "../../main";
import type {
  SlashCommandCatalog,
  SlashCommandDropdownConfig,
} from "../../pi/agent/commands/SlashCommandCatalog";
import type { SlashCatalogEntry } from "../../pi/agent/commands/SlashCommandEntry";
import type { FileStore } from "../../pi/storage/FileStore";
import type { SlashCommand } from "../../pi/types";

const COMMANDS_DIR = ".pivi/commands";
const LEGACY_TEMPLATES_DIR = ".pivi/templates";

/**
 * Parses simple markdown templates containing optional YAML frontmatter.
 */
export function parseMarkdownTemplate(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  const fmText = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, string> = {};

  const lines = fmText.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      const val = line.substring(colonIndex + 1).trim();
      // Remove optional surrounding quotes
      const cleanVal = val.replace(/^["']|["']$/g, "");
      frontmatter[key] = cleanVal;
    }
  }
  return { frontmatter, body };
}

export class PiSlashCommandCatalog implements SlashCommandCatalog {
  private vaultEntries: SlashCatalogEntry[] = [];
  private runtimeCommands: SlashCatalogEntry[] = [];
  private isWatching = false;

  constructor(
    private readonly plugin: PiviPlugin,
    private readonly adapter: FileStore,
  ) {
    this.registerVaultWatcher();
  }

  private registerVaultWatcher(): void {
    if (this.isWatching) return;
    this.isWatching = true;

    const isCommandPath = (path: string) =>
      (path.startsWith(`${COMMANDS_DIR}/`) ||
        path.startsWith(`${LEGACY_TEMPLATES_DIR}/`)) &&
      path.endsWith(".md");

    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file: TAbstractFile) => {
        if (isCommandPath(file.path)) {
          void this.refresh();
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (isCommandPath(file.path)) {
          void this.refresh();
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        if (isCommandPath(file.path)) {
          void this.refresh();
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          if (isCommandPath(file.path) || isCommandPath(oldPath)) {
            void this.refresh();
          }
        },
      ),
    );
  }

  async listDropdownEntries(context: {
    includeBuiltIns: boolean;
  }): Promise<SlashCatalogEntry[]> {
    if (this.vaultEntries.length === 0) {
      await this.refresh();
    }
    const combined = [...this.vaultEntries];

    // Add default create-command entry
    combined.push({
      id: "create-command",
      kind: "command",
      name: "create-command",
      description: "Create a custom slash command / prompt template",
      content: "",
      argumentHint: "",
      scope: "builtin",
      source: "builtin",
      isEditable: false,
      isDeletable: false,
      displayPrefix: "/",
      insertPrefix: "/",
    });

    if (context.includeBuiltIns) {
      combined.push(...this.runtimeCommands);
    }
    return combined;
  }

  async listVaultEntries(): Promise<SlashCatalogEntry[]> {
    if (this.vaultEntries.length === 0) {
      await this.refresh();
    }
    return this.vaultEntries;
  }

  async saveVaultEntry(entry: SlashCatalogEntry): Promise<void> {
    await this.adapter.ensureFolder(COMMANDS_DIR);
    const path = `${COMMANDS_DIR}/${entry.id}.md`;
    const frontmatter = `---
description: ${entry.description ?? ""}
argumentHint: ${entry.argumentHint ?? ""}
---
${entry.content}`;
    await this.adapter.write(path, frontmatter);

    if (entry.persistenceKey?.startsWith("legacy-template:")) {
      const legacyPath = `${LEGACY_TEMPLATES_DIR}/${entry.id}.md`;
      if (await this.adapter.exists(legacyPath)) {
        await this.adapter.delete(legacyPath);
      }
    }
    await this.refresh();
  }

  async deleteVaultEntry(entry: SlashCatalogEntry): Promise<void> {
    for (const dir of [COMMANDS_DIR, LEGACY_TEMPLATES_DIR]) {
      const path = `${dir}/${entry.id}.md`;
      if (await this.adapter.exists(path)) {
        await this.adapter.delete(path);
      }
    }
    await this.refresh();
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = commands.map((cmd) => ({
      id: cmd.id,
      kind: cmd.kind ?? "command",
      name: cmd.name,
      description: cmd.description,
      content: cmd.content,
      argumentHint: cmd.argumentHint,
      allowedTools: cmd.allowedTools,
      model: cmd.model,
      disableModelInvocation: cmd.disableModelInvocation,
      userInvocable: cmd.userInvocable,
      context: cmd.context,
      agent: cmd.agent,
      hooks: cmd.hooks,
      scope: "runtime",
      source: cmd.source ?? "sdk",
      isEditable: false,
      isDeletable: false,
      displayPrefix: "/",
      insertPrefix: "/",
    }));
  }

  getDropdownConfig(): SlashCommandDropdownConfig {
    return {
      triggerChars: ["/"],
      builtInPrefix: "/",
      skillPrefix: "/",
      commandPrefix: "/",
    };
  }

  async refresh(): Promise<void> {
    try {
      await this.adapter.ensureFolder(COMMANDS_DIR);
      const byId = new Map<string, SlashCatalogEntry>();

      for (const dir of [LEGACY_TEMPLATES_DIR, COMMANDS_DIR]) {
        const files = await this.adapter.listFiles(dir);
        const mdFiles = files.filter((f) => f.endsWith(".md"));

        for (const file of mdFiles) {
          try {
            const content = await this.adapter.read(file);
            const { frontmatter, body } = parseMarkdownTemplate(content);

            const parts = file.split("/");
            const filename = parts[parts.length - 1];
            const id = filename.substring(0, filename.lastIndexOf(".md"));

            byId.set(id, {
              id,
              kind: "command",
              name: id,
              description:
                frontmatter.description ?? `Custom command from ${filename}`,
              content: body,
              argumentHint: frontmatter.argumentHint ?? "text",
              scope: "vault",
              source: "user",
              isEditable: true,
              isDeletable: true,
              displayPrefix: "/",
              insertPrefix: "/",
              persistenceKey:
                dir === LEGACY_TEMPLATES_DIR
                  ? `legacy-template:${id}`
                  : `vault:${id}`,
            });
          } catch (e) {
            console.error(`Pivi: Failed to parse custom command ${file}:`, e);
          }
        }
      }
      this.vaultEntries = [...byId.values()];
    } catch (e) {
      console.error("Pivi: Failed to refresh slash command catalog:", e);
    }
  }
}
