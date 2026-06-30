import { Platform } from "obsidian";

import { AgentServices } from "../../../core/agent/AgentServices";
import { AgentSettingsCoordinator } from "../../../core/agent/AgentSettingsCoordinator";
import { AgentWorkspace } from "../../../core/agent/AgentWorkspace";
import { getHiddenSlashCommandSet } from "../../../core/agent/commands/hiddenCommands";
import type {
  ChatUIConfig,
  RuntimeCapabilities,
} from "../../../core/agent/types";
import type { PiviSettings } from "../../../core/types";
import type PiviPlugin from "../../../main";
import type { TabAgentContext, TabData } from "./types";

/** Draft model for a new blank tab from the active agent settings snapshot. */
export function resolveBlankTabModel(plugin: PiviPlugin): string {
  const snapshot = AgentSettingsCoordinator.getAgentSettingsSnapshot(
    plugin.settings,
  );
  return snapshot.model;
}

export type TabAgentSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

export function getTabCapabilities(tab: TabAgentContext): RuntimeCapabilities {
  return tab.service?.getCapabilities() ?? AgentServices.getCapabilities();
}

export function getTabChatUIConfig(
  _tab: TabAgentContext,
  _plugin: PiviPlugin,
  _openSession?: unknown,
): ChatUIConfig {
  return AgentServices.getChatUIConfig();
}

export function getTabSettingsSnapshot(
  tab: TabAgentContext,
  plugin: PiviPlugin,
): TabAgentSettings {
  return AgentSettingsCoordinator.getAgentSettingsSnapshot(plugin.settings);
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
  AgentSettingsCoordinator.commitAgentSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  await plugin.saveSettings();
  return snapshot;
}

export function refreshTabAgentUI(tab: TabData, plugin: PiviPlugin): void {
  const capabilities = getTabCapabilities(tab);
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.modeSelector?.updateDisplay();
  tab.ui.modeSelector?.renderOptions();
  tab.ui.thinkingBudgetSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    "pivi-input-plan-mode",
    permissionMode === "plan" && capabilities.supportsPlanMode,
  );
}

export function applyCapabilityUIGating(tab: TabData): void {
  const capabilities = getTabCapabilities(tab);
  const uiConfig = AgentServices.getChatUIConfig();
  const hasPermissionToggle = Boolean(uiConfig.getPermissionModeToggle?.());

  if (!capabilities.supportsMcpTools) {
    tab.ui.mcpServerSelector?.clearEnabled();
    tab.ui.mcpServerSelector?.setMcpManager(null);
    tab.ui.fileContextManager?.setMcpManager(null);
  } else {
    const mcpManager = AgentWorkspace.getMcpServerManager();
    tab.ui.mcpServerSelector?.setMcpManager(mcpManager);
    tab.ui.fileContextManager?.setMcpManager(mcpManager);
  }
  tab.ui.mcpServerSelector?.setVisible(capabilities.supportsMcpTools);
  tab.ui.permissionToggle?.setVisible(hasPermissionToggle);
  tab.ui.fileContextManager?.setAgentService(null);

  tab.ui.imageContextManager?.setEnabled(capabilities.supportsImageAttachments);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

export function syncTabAgentServices(tab: TabData, plugin: PiviPlugin): void {
  tab.services.subagentManager.setTaskResultInterpreter?.(
    AgentServices.getTaskResultInterpreter(),
  );
}

export function ensureTitleGenerationService(
  tab: TabData,
  plugin: PiviPlugin,
): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService =
      AgentServices.createTitleGenerationService(plugin.getAgentHostContext());
  }
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === "function") {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}
