import { Platform } from "obsidian";

import { getHiddenSlashCommandSet } from "../../../core/agent/commands/hiddenCommands";
import type { ChatUIConfig } from "../../../core/agent/types";
import type { PiviSettings } from "../../../core/types";
import type PiviPlugin from "../../../main";
import { PiSettingsCoordinator } from "../../../pi/PiSettingsCoordinator";
import { PiTaskResultInterpreter, PiTitleGenerationService } from "../../../pi/services";
import { piChatUIConfig } from "../../../pi/ui/PiChatUIConfig";
import type { TabAgentContext, TabData } from "./types";

const piTaskResultInterpreter = new PiTaskResultInterpreter();

/** Draft model for a new blank tab from the active agent settings snapshot. */
export function resolveBlankTabModel(plugin: PiviPlugin): string {
  const snapshot = PiSettingsCoordinator.getSettingsSnapshot(plugin.settings);
  return snapshot.model;
}

export type TabAgentSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

export function getTabChatUIConfig(
  _tab: TabAgentContext,
  _plugin: PiviPlugin,
  _openSession?: unknown,
): ChatUIConfig {
  return piChatUIConfig;
}

export function getTabSettingsSnapshot(
  tab: TabAgentContext,
  plugin: PiviPlugin,
): TabAgentSettings {
  return PiSettingsCoordinator.getSettingsSnapshot(plugin.settings);
}

export function getTabPermissionMode(
  tab: TabAgentContext,
  plugin: PiviPlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === "string" && permissionMode
    ? permissionMode
    : "normal";
}

export function getTabHiddenCommands(
  tab: TabAgentContext,
  plugin: PiviPlugin,
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
  plugin: PiviPlugin,
  update: (settings: TabAgentSettings) => void,
): Promise<TabAgentSettings> {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  PiSettingsCoordinator.commitSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  await plugin.saveSettings();
  return snapshot;
}

export function refreshTabAgentUI(tab: TabData, plugin: PiviPlugin): void {
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.modeSelector?.updateDisplay();
  tab.ui.modeSelector?.renderOptions();
  tab.ui.thinkingBudgetSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    "pivi-input-plan-mode",
    permissionMode === "plan",
  );
}

export function applyCapabilityUIGating(tab: TabData, plugin: PiviPlugin): void {
  const uiConfig = piChatUIConfig;
  const hasPermissionToggle = Boolean(uiConfig.getPermissionModeToggle?.());
  const mcpManager = plugin.getPiWorkspace()?.mcpServerManager ?? null;

  tab.ui.mcpServerSelector?.setMcpManager(mcpManager);
  tab.ui.fileContextManager?.setMcpManager(mcpManager);
  tab.ui.mcpServerSelector?.setVisible(true);
  tab.ui.permissionToggle?.setVisible(hasPermissionToggle);
  tab.ui.fileContextManager?.setAgentService(null);

  tab.ui.imageContextManager?.setEnabled(true);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

export function syncTabPiServices(tab: TabData, plugin: PiviPlugin): void {
  tab.services.subagentManager.setTaskResultInterpreter?.(
    piTaskResultInterpreter,
  );
}

export function ensureTitleGenerationService(
  tab: TabData,
  plugin: PiviPlugin,
): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService =
      new PiTitleGenerationService(plugin);
  }
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === "function") {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}
