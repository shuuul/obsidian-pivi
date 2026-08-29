import { randomUUID } from 'node:crypto';

import { writeFileAtomically } from '@pivi/agent/config/publication';
import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import type { FileStore } from "@pivi/agent/ports";
import type { SlashCommand } from "@pivi/agent/settings";
import type {
  SlashCommandCatalog,
  SlashCommandDropdownConfig,
} from "@pivi/agent/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import {
  COMPACT_COMMAND_ID,
  GENERATE_IMAGE_TOOL_ID,
  isReservedCommandId,
  NEW_SESSION_COMMAND_ID,
} from "@pivi/agent/skills/commands/slashCommandIds";
import {
  parseSlashCommandContent,
  serializeSlashCommandMarkdown,
} from "@pivi/agent/skills/slashCommand";
import { TOOL_OBSIDIAN_GENERATE_IMAGE } from "@pivi/agent/tools/obsidianToolNames";
import type {
  AgentCommandSummary,
  PiviCommandsGetResult,
  PiviCommandsInput,
  PiviCommandsListResult,
} from '@pivi/agent/tools/piviManagement';
import type { TAbstractFile } from "obsidian";

import { t } from '@/app/i18n';

import type { PiviWorkspaceHost } from "./serviceContracts";
import {
  PiviCommandsManagementError,
  WorkspaceCommandsCoordinator,
  type WorkspaceCommandsPlan,
} from './WorkspaceCommandsCoordinator';
export { PiviCommandsManagementError } from './WorkspaceCommandsCoordinator';

const COMMANDS_DIR = ".pivi/commands";
const LEGACY_TEMPLATES_DIR = ".pivi/templates";
const logger = new PluginLogger('PiSlashCommandCatalog');

export interface PiSlashCommandCatalogOptions {
  isImageGenerationEnabled?: () => boolean;
  createIntegrationKey?: () => string;
  onWorkspaceEntriesChanged?: (entries: readonly SlashCatalogEntry[]) => void;
}

export interface WorkspaceCommandCatalogSnapshot {
  readonly entries: readonly SlashCatalogEntry[];
  readonly catalogRevision: number;
}

export class PiSlashCommandCatalog implements SlashCommandCatalog {
  private runtimeCommands: SlashCatalogEntry[] = [];
  private isWatching = false;
  private loaded = false;
  private readonly generatedIntegrationKeys = new Map<string, string>();
  private readonly reportedReservedPaths = new Set<string>();
  readonly commandsCoordinator: WorkspaceCommandsCoordinator;

  constructor(
    private readonly plugin: PiviWorkspaceHost,
    private readonly adapter: FileStore,
    private readonly options: PiSlashCommandCatalogOptions = {},
  ) {
    this.commandsCoordinator = new WorkspaceCommandsCoordinator(
      plugin,
      adapter,
      () => this.createIntegrationKey(),
      () => this.scanWorkspaceCommands(),
      entries => this.options.onWorkspaceEntriesChanged?.(entries.map(entry => ({ ...entry }))),
    );
    this.registerVaultWatcher();
  }

  private registerVaultWatcher(): void {
    if (this.isWatching) return;
    this.isWatching = true;

    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          if (isCatalogCommandPath(file.path) || isCatalogCommandPath(oldPath)) {
            void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
          }
        },
      ),
    );
  }

  async listDropdownEntries(context: {
    includeBuiltIns: boolean;
  }): Promise<SlashCatalogEntry[]> {
    if (!this.loaded) {
      await this.refresh();
    }
    const combined = this.commandsCoordinator.currentEntries();

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

    combined.push({
      id: NEW_SESSION_COMMAND_ID,
      kind: "command",
      name: NEW_SESSION_COMMAND_ID,
      description: t('chat.slash.newSessionDescription'),
      content: "",
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
    if (!this.loaded) {
      await this.refresh();
    }
    return this.commandsCoordinator.currentEntries();
  }

  async getWorkspaceSnapshot(): Promise<WorkspaceCommandCatalogSnapshot> {
    const snapshot = await this.commandsCoordinator.snapshot();
    this.loaded = true;
    return snapshot;
  }

  async saveWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<void> {
    await this.commandsCoordinator.saveEntry(entry, catalogRevision);
  }

  async renameWorkspaceEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, catalogRevision: number): Promise<void> {
    await this.commandsCoordinator.renameEntry(previous, entry, catalogRevision);
  }

  async deleteWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<{
    saved: true;
    refreshed: boolean;
    warnings?: string[];
  }> {
    const result = await this.commandsCoordinator.deleteEntry(entry, catalogRevision);
    return {
      saved: true,
      refreshed: result.refreshed,
      ...(result.warnings ? { warnings: [...result.warnings] } : {}),
    };
  }

  async saveWorkspaceOrder(ids: readonly string[], catalogRevision: number): Promise<void> {
    await this.commandsCoordinator.saveOrder(ids, catalogRevision);
  }

  planCommands(input: Extract<PiviCommandsInput, { action: 'upsert' | 'remove' | 'move' }>, signal?: AbortSignal): Promise<WorkspaceCommandsPlan> {
    return this.commandsCoordinator.plan(input, signal);
  }

  commitCommands(plan: WorkspaceCommandsPlan, revision: number, signal?: AbortSignal) {
    return this.commandsCoordinator.commit(plan, revision, signal);
  }

  async executeCommands(input: PiviCommandsInput, signal?: AbortSignal): Promise<unknown> {
    if (input.action === 'list') return this.agentList();
    if (input.action === 'get') return this.agentGet(input.id);
    const plan = await this.planCommands(input, signal);
    return this.commitCommands(plan, plan.revision, signal);
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = commands.filter(cmd => !isReservedCommandId(cmd.id)).map((cmd) => ({
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
    this.commandsCoordinator.setRuntimeIds(this.runtimeCommands.map(command => command.id));
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
    await this.commandsCoordinator.refresh();
    this.loaded = true;
  }

  async prepareWorkspace(): Promise<void> {
    await this.commandsCoordinator.withMutationLock(async () => {
      await this.adapter.ensureFolder(COMMANDS_DIR);
      const files = (await Promise.all([COMMANDS_DIR, LEGACY_TEMPLATES_DIR]
        .map(dir => this.adapter.listFiles(dir)))).flat().filter(path => isCatalogCommandPath(path));
      for (const file of files) {
        const id = commandIdFromPath(file);
        if (isReservedCommandId(id)) {
          this.reportReservedWorkspaceFile(file, id);
          continue;
        }
        const content = await this.adapter.read(file);
        const parsed = parseSlashCommandContent(content);
        if (typeof parsed.integrationKey === 'string'
          && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(parsed.integrationKey)) continue;
        const filename = file.split('/').at(-1);
        if (!filename) throw new Error(`Custom command has no filename: ${file}`);
        const integrationKey = this.createIntegrationKey();
        await writeFileAtomically(this.adapter, file, serializeSlashCommandMarkdown({
          id, name: id, description: parsed.description, argumentHint: parsed.argumentHint || id,
          icon: parsed.icon, integrationKey, content: parsed.promptContent,
        }, parsed.promptContent));
      }
      await this.commandsCoordinator.refreshWithoutLock();
      this.loaded = true;
    });
  }

  private async scanWorkspaceCommands(): Promise<{
    readonly entries: readonly SlashCatalogEntry[];
    readonly fingerprint: string;
  }> {
    const byId = new Map<string, SlashCatalogEntry>();
    const authoritativeBytes: Array<[string, string, string]> = [];

    for (const dir of [LEGACY_TEMPLATES_DIR, COMMANDS_DIR]) {
      const files = await this.adapter.listFiles(dir);
      for (const file of files.filter(isCatalogCommandPath)) {
        try {
          const id = commandIdFromPath(file);
          if (isReservedCommandId(id)) {
            this.reportReservedWorkspaceFile(file, id);
            continue;
          }
          const content = await this.adapter.read(file);
          const parsed = parseSlashCommandContent(content);
          authoritativeBytes.push([dir, file, content]);

          const filename = file.split("/").at(-1);
          if (!filename) {
            logger.error(`Custom command has no filename: ${file}`);
            continue;
          }
          const integrationKey = typeof parsed.integrationKey === 'string'
            && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(parsed.integrationKey)
            ? parsed.integrationKey
            : this.generatedIntegrationKeys.get(id) ?? this.createIntegrationKey();
          this.generatedIntegrationKeys.set(id, integrationKey);

          byId.set(id, {
            id,
            kind: "command",
            name: id,
            description: parsed.description ?? `Custom command from ${filename}`,
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
            persistenceKey: dir === LEGACY_TEMPLATES_DIR
              ? `legacy-template:${id}`
              : `vault:${id}`,
          });
        } catch (error) {
          logger.error(`Failed to parse custom command ${file}`, error);
          throw error;
        }
      }
    }
    const order = this.plugin.settings.workspaceCommandOrder ?? [];
    const rank = new Map(order.map((id, index) => [id, index]));
    const entries = [...byId.values()].sort((a, b) => {
      const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
    return {
      entries,
      fingerprint: JSON.stringify({
        files: authoritativeBytes,
        identities: entries.map(entry => [entry.id, entry.integrationKey]),
        order,
      }),
    };
  }

  private async agentList(): Promise<PiviCommandsListResult> {
    await this.refresh();
    return {
      commands: this.commandsCoordinator.currentEntries().map(toAgentSummary),
      catalogRevision: this.commandsCoordinator.currentRevision(),
    };
  }

  private async agentGet(id: string): Promise<PiviCommandsGetResult> {
    await this.refresh();
    const entry = this.commandsCoordinator.currentEntries().find(candidate => candidate.id === id);
    if (!entry) throw new PiviCommandsManagementError('not_found', `Command /${id} was not found.`);
    return {
      command: { ...toAgentSummary(entry), content: entry.content },
      catalogRevision: this.commandsCoordinator.currentRevision(),
    };
  }

  private createIntegrationKey(): string {
    return this.options.createIntegrationKey?.() ?? randomUUID();
  }

  private reportReservedWorkspaceFile(path: string, id: string): void {
    if (this.reportedReservedPaths.has(path)) return;
    this.reportedReservedPaths.add(path);
    logger.warn(
      `Ignored ${path} because /${id} is reserved by Pivi. The file was preserved; rename it to a non-reserved command ID to use its content.`,
    );
  }
}

function toAgentSummary(entry: SlashCatalogEntry): AgentCommandSummary {
  return { id: entry.id, name: entry.name, description: entry.description,
    argumentHint: entry.argumentHint, icon: entry.icon, scope: entry.scope,
    source: entry.source, isEditable: entry.isEditable, isDeletable: entry.isDeletable };
}

/** Catalog command markdown only — never removal artifacts or non-md siblings. */
function isCatalogCommandPath(path: string): boolean {
  if (!path.endsWith('.md')) return false;
  const slash = path.lastIndexOf('/');
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  if (filename.includes('.')) {
    // Preserve the legacy discovery contract: exactly one trailing `.md`
    // extension, excluding removal and temporary artifacts.
    if (filename.slice(0, -3).includes('.')) return false;
  }
  return path.startsWith(`${COMMANDS_DIR}/`) || path.startsWith(`${LEGACY_TEMPLATES_DIR}/`);
}

function commandIdFromPath(path: string): string {
  const filename = path.split('/').at(-1);
  if (!filename) throw new Error(`Custom command has no filename: ${path}`);
  return filename.slice(0, -3);
}
