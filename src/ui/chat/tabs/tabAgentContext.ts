import type { ChatPorts } from '@pivi/obsidian-ui/ports';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { ChatUIConfig } from '@pivi/pivi-agent-core/foundation/chatUi';
import { getHiddenSlashCommandSet } from "@pivi/pivi-agent-core/foundation/settings";
import { QueryBackedTitleGenerationService } from '@pivi/pivi-agent-core/runtime/queryBackedTitleGenerationService';
import { Platform } from "obsidian";

import type { PiviChatHost } from '@/app/hostContracts';

import { createFileContextMcpProvider } from "./tabCatalogAdapters";
import type { TabAgentContext, TabData } from "./types";

/** Draft model for a new blank tab from the active agent settings snapshot. */
export function resolveBlankTabModel(plugin: PiviChatHost): string {
  const snapshot = plugin.getUiFacades().getSettingsSnapshot(plugin.settings);
  return snapshot.model;
}

export type TabAgentSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  customContextLimits?: Record<string, number>;
};

export function getTabChatUIConfig(
  _tab: TabAgentContext,
  plugin: PiviChatHost,
  _openSession?: unknown,
): ChatUIConfig {
  return plugin.getUiFacades().chatUIConfig;
}

export function getTabSettingsSnapshot(
  tab: TabAgentContext,
  plugin: PiviChatHost,
): TabAgentSettings {
  return plugin.getUiFacades().getSettingsSnapshot(plugin.settings);
}

export function getTabHiddenCommands(
  tab: TabAgentContext,
  plugin: PiviChatHost,
  openSession?: unknown,
): Set<string> {
  return getHiddenSlashCommandSet(plugin.settings);
}

export function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<PiviSettings, "requireCommandOrControlEnterToSend">,
): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) {
    return false;
  }

  if (settings.requireCommandOrControlEnterToSend !== true) {
    return true;
  }

  if (Platform.isMacOS) {
    return e.metaKey === true && !e.ctrlKey && !e.altKey;
  }

  return e.ctrlKey === true && !e.metaKey && !e.altKey;
}

export async function updateTabAgentSettings(
  tab: TabAgentContext,
  plugin: PiviChatHost,
  update: (settings: TabAgentSettings) => void,
): Promise<TabAgentSettings> {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  plugin.getUiFacades().commitSettingsSnapshot(plugin.settings, snapshot);
  await plugin.saveSettings();
  return snapshot;
}

export function refreshTabAgentUI(tab: TabData, _plugin: PiviChatHost): void {
  tab.ui.composerActions?.refresh();
}

export function applyCapabilityUIGating(tab: TabData, ports: ChatPorts): void {
  tab.ui.fileContextManager?.setMcpManager(createFileContextMcpProvider(ports.catalog));
  tab.ui.fileContextManager?.setAgentService(null);

  tab.ui.imageContextManager?.setEnabled(true);
}

export function ensureTitleGenerationService(
  tab: TabData,
  plugin: PiviChatHost,
): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = new QueryBackedTitleGenerationService({
      createRunner: () => plugin.createAuxQueryRunner(),
      resolveModel: () => plugin.settings.titleGenerationModel?.trim() || undefined,
    });
  }
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === "function") {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}
