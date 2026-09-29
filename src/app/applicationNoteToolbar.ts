import type { ProcessRunner } from "@pivi/agent/ports";
import type { PiviSettings } from "@pivi/agent/settings";
import { getObsidianToolsSettingsFromBag } from "@pivi/agent/settings/types";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import { ObsidianCliTransport } from "@pivi/obsidian-host/cli/obsidianCliTransport";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import { openExternalUrl } from "@pivi/obsidian-host/openExternalUrl";
import type { App } from "obsidian";
import { apiVersion, getIcon } from "obsidian";

import { ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID } from "@/app/commandRegistration";
import { getVaultPath } from "@/app/hostPlatform";
import { t } from "@/app/i18n";
import {
  getInstalledPluginVersion,
  isNoteToolbarInstalled,
  isPluginEnabled,
  type NoteToolbarItemApi,
  type NoteToolbarItemStyle,
  type NoteToolbarSetupQueue,
  type NoteToolbarSetupResult,
  runQueuedNoteToolbarRequest,
  runQueuedNoteToolbarSetup,
  setupNoteToolbarIntegration as setupNoteToolbar,
} from "@/app/noteToolbarIntegration";
import { getWorkspaceCommandFullId } from "@/app/workspaceCommandRegistry";

export interface ApplicationNoteToolbarDeps {
  app: App;
  pluginId: string;
  processRunner: ProcessRunner;
  getSettings(): PiviSettings;
  /** Registers workspace commands so a new toolbar item targets a live command id. */
  reconcileWorkspaceCommands(): Promise<void>;
}

type NoteToolbarItemOptions = Pick<
  Parameters<typeof setupNoteToolbar>[0],
  'commandId' | 'itemStyle' | 'itemIcon' | 'itemTooltip'
>;

function getNoteToolbarItemApi(itemId: string): NoteToolbarItemApi | null {
  const api = (window as Window & {
    ntb?: { getItem?: (id: string) => NoteToolbarItemApi | undefined };
  }).ntb?.getItem?.(itemId);
  return api ?? null;
}

/** Note Toolbar setup for the selection command and per-workspace-command items, sharing one setup queue. */
export class ApplicationNoteToolbar {
  private readonly setupQueue: NoteToolbarSetupQueue = { active: null };

  constructor(private readonly deps: ApplicationNoteToolbarDeps) {}

  private runSetup(item: NoteToolbarItemOptions): Promise<NoteToolbarSetupResult> {
    const { app, processRunner } = this.deps;
    const toolSettings = getObsidianToolsSettingsFromBag(this.deps.getSettings());
    const cli = new ObsidianCliTransport(toolSettings, {
      processRunner,
      vaultPath: getVaultPath(app),
    });
    return setupNoteToolbar({
      adapter: app.vault.adapter,
      apiVersion,
      cliAvailable: toolSettings.cliEnabled && isOfficialObsidianCliEnabled(),
      configDir: app.vault.configDir,
      ...item,
      getItemApi: getNoteToolbarItemApi,
      getInstalledPluginVersion: (pluginId) => getInstalledPluginVersion(app, pluginId),
      isPluginEnabled: (pluginId) => isPluginEnabled(app, pluginId),
      openUri: openExternalUrl,
      runCli: (args) => cli.run({ vaultName: app.vault.getName(), args }),
    });
  }

  isInstalled(): Promise<boolean> {
    return Promise.resolve(
      isNoteToolbarInstalled((pluginId) => getInstalledPluginVersion(this.deps.app, pluginId)),
    );
  }

  setupSelectionCommand(itemStyle: NoteToolbarItemStyle): Promise<NoteToolbarSetupResult> {
    return runQueuedNoteToolbarSetup(this.setupQueue, itemStyle, (style) => this.runSetup({
      commandId: `${this.deps.pluginId}:${ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID}`,
      itemStyle: style,
      itemTooltip: t("settings.noteToolbar.itemTooltip"),
    }));
  }

  async setupWorkspaceCommand(entry: SlashCatalogEntry): Promise<NoteToolbarSetupResult> {
    const integrationKey = entry.integrationKey;
    if (!integrationKey) {
      throw new Error(`Workspace command /${entry.name} has no integration key`);
    }
    await this.deps.reconcileWorkspaceCommands();
    const icon = entry.icon && getIcon(entry.icon) ? entry.icon : 'message-square';
    const key = `${integrationKey}:${icon}`;
    return runQueuedNoteToolbarRequest(this.setupQueue, key, () => this.runSetup({
      commandId: getWorkspaceCommandFullId(this.deps.pluginId, integrationKey),
      itemStyle: 'icon-only',
      itemIcon: icon,
      itemTooltip: t('settings.noteToolbar.commandTooltip', { name: entry.name }),
    }));
  }
}
