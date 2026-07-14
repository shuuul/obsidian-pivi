import { randomUUID } from 'node:crypto';

import type { SlashCommand } from "@pivi/pivi-agent-core/foundation";
import { PluginLogger } from "@pivi/pivi-agent-core/foundation/pluginLogger";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type {
  SlashCommandCatalog,
  SlashCommandDropdownConfig,
} from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";
import {
  COMPACT_COMMAND_ID,
  GENERATE_IMAGE_TOOL_ID,
} from "@pivi/pivi-agent-core/skills/commands/slashCommandIds";
import {
  parseSlashCommandContent,
  serializeSlashCommandMarkdown,
} from "@pivi/pivi-agent-core/skills/slashCommand";
import { TOOL_OBSIDIAN_GENERATE_IMAGE } from "@pivi/pivi-agent-core/tools/obsidianToolNames";
import type { TAbstractFile } from "obsidian";

import type { PiviWorkspaceHost } from "./serviceContracts";

const COMMANDS_DIR = ".pivi/commands";
const LEGACY_TEMPLATES_DIR = ".pivi/templates";
const logger = new PluginLogger('PiSlashCommandCatalog');

export interface PiSlashCommandCatalogOptions {
  isImageGenerationEnabled?: () => boolean;
  createIntegrationKey?: () => string;
  onWorkspaceEntriesChanged?: (entries: readonly SlashCatalogEntry[]) => void;
}

export class PiSlashCommandCatalog implements SlashCommandCatalog {
  private workspaceEntries: SlashCatalogEntry[] = [];
  private runtimeCommands: SlashCatalogEntry[] = [];
  private isWatching = false;

  constructor(
    private readonly plugin: PiviWorkspaceHost,
    private readonly adapter: FileStore,
    private readonly options: PiSlashCommandCatalogOptions = {},
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
    if (this.workspaceEntries.length === 0) {
      await this.refresh();
    }
    const combined = [...this.workspaceEntries];

    if (this.options.isImageGenerationEnabled?.()) {
      combined.push({
        id: GENERATE_IMAGE_TOOL_ID,
        kind: "tool",
        name: GENERATE_IMAGE_TOOL_ID,
        description: "Generate an image with the enabled image tool",
        content: "",
        toolName: TOOL_OBSIDIAN_GENERATE_IMAGE,
        scope: "builtin",
        source: "builtin",
        isEditable: false,
        isDeletable: false,
        displayPrefix: "/",
        insertPrefix: "/",
      });
    }

    combined.push({
      id: COMPACT_COMMAND_ID,
      kind: "command",
      name: COMPACT_COMMAND_ID,
      description: "Compact this session to preserve context",
      content: "/compact",
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

  async listWorkspaceEntries(): Promise<SlashCatalogEntry[]> {
    if (this.workspaceEntries.length === 0) {
      await this.refresh();
    }
    return this.workspaceEntries;
  }

  async saveWorkspaceEntry(entry: SlashCatalogEntry): Promise<void> {
    await this.adapter.ensureFolder(COMMANDS_DIR);
    const path = `${COMMANDS_DIR}/${entry.id}.md`;
    const command: SlashCommand = {
      ...entry,
      kind: 'command',
      argumentHint: entry.argumentHint?.trim() || entry.name,
      integrationKey: entry.integrationKey ?? this.createIntegrationKey(),
    };
    await this.adapter.write(
      path,
      serializeSlashCommandMarkdown(command, entry.content),
    );

    if (entry.persistenceKey?.startsWith("legacy-template:")) {
      const legacyPath = `${LEGACY_TEMPLATES_DIR}/${entry.id}.md`;
      if (await this.adapter.exists(legacyPath)) {
        await this.adapter.delete(legacyPath);
      }
    }
    await this.refresh();
  }

  async deleteWorkspaceEntry(entry: SlashCatalogEntry): Promise<void> {
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
      icon: cmd.icon,
      integrationKey: cmd.integrationKey,
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
            const parsed = parseSlashCommandContent(content);

            const parts = file.split("/");
            const filename = parts.at(-1);
            if (!filename) {
              logger.error(`Custom command has no filename: ${file}`);
              continue;
            }
            const id = filename.substring(0, filename.lastIndexOf(".md"));
            const integrationKey = typeof parsed.integrationKey === 'string'
              && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(parsed.integrationKey)
              ? parsed.integrationKey
              : this.createIntegrationKey();

            if (integrationKey !== parsed.integrationKey && dir === COMMANDS_DIR) {
              await this.adapter.write(
                file,
                serializeSlashCommandMarkdown({
                  id,
                  name: id,
                  description: parsed.description,
                  argumentHint: parsed.argumentHint || id,
                  icon: parsed.icon,
                  integrationKey,
                  content: parsed.promptContent,
                }, parsed.promptContent),
              );
            }

            byId.set(id, {
              id,
              kind: "command",
              name: id,
              description:
                parsed.description ?? `Custom command from ${filename}`,
              content: parsed.promptContent,
              argumentHint: parsed.argumentHint || id,
              icon: parsed.icon,
              integrationKey,
              scope: "workspace",
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
            logger.error(`Failed to parse custom command ${file}`, e);
          }
        }
      }
      this.workspaceEntries = [...byId.values()];
      this.options.onWorkspaceEntriesChanged?.(this.workspaceEntries);
    } catch (e) {
      logger.error("Failed to refresh slash command catalog", e);
    }
  }

  private createIntegrationKey(): string {
    return this.options.createIntegrationKey?.() ?? randomUUID();
  }
}
