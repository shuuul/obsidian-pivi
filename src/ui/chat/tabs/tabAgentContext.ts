import { getHiddenSlashCommandSet } from "@pivi/pivi-agent-core/foundation/settings";
import type {
  ChatPorts,
  ChatSettingsPort,
  ChatSettingsSnapshot,
} from '@pivi/pivi-agent-core/runtime/chatPorts';
import { QueryBackedTitleGenerationService } from '@pivi/pivi-agent-core/runtime/queryBackedTitleGenerationService';
import { Platform } from "obsidian";

import { createFileContextMcpProvider } from "./tabCatalogAdapters";
import type { TabAgentContext, TabData } from "./types";

/** Draft model for a new blank tab from the active agent settings snapshot. */
export function resolveBlankTabModel(ports: ChatPorts): string {
  return ports.settings.getSettingsSnapshot().model;
}

export type TabAgentSettings = ChatSettingsSnapshot;

export function getTabHiddenCommands(
  tab: TabAgentContext,
  settings: ChatSettingsPort,
  openSession?: unknown,
): Set<string> {
  return getHiddenSlashCommandSet(settings.getSettingsSnapshot());
}

export function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<ChatSettingsSnapshot, "requireCommandOrControlEnterToSend">,
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
  ports: ChatPorts,
  update: (settings: TabAgentSettings) => void,
): Promise<TabAgentSettings> {
  const snapshot = ports.settings.getSettingsSnapshot();
  update(snapshot);
  await ports.settings.commitSettingsSnapshot(snapshot);
  return snapshot;
}

export function applyCapabilityUIGating(tab: TabData, ports: ChatPorts): void {
  tab.ui.fileContextManager?.setMcpManager(createFileContextMcpProvider(ports.catalog));
  tab.ui.fileContextManager?.setAgentService(null);

  tab.ui.imageContextManager?.setEnabled(true);
}

export function ensureTitleGenerationService(
  tab: TabData,
  ports: ChatPorts,
): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = new QueryBackedTitleGenerationService({
      createRunner: () => ports.runtime.createAuxQueryRunner(),
      resolveModel: () => (
        ports.settings.getSettingsSnapshot().titleGenerationModel.trim() || undefined
      ),
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
