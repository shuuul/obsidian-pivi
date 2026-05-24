import { Platform } from 'obsidian';

import { PiAgentServices } from '../../../core/agent/PiAgentServices';
import { AgentSettingsCoordinator } from '../../../core/agent/AgentSettingsCoordinator';
import { AgentWorkspace } from '../../../core/agent/AgentWorkspace';
import { getHiddenSlashCommandSet } from '../../../core/agent/commands/hiddenCommands';
import type {
  ChatUIConfig,
  RuntimeCapabilities,
} from '../../../core/agent/types';
import type { ObsiusSettings } from '../../../core/types';
import type ObsiusPlugin from '../../../main';
import type { TabAgentContext, TabData } from './types';

/** Draft model for a new blank tab from the active agent settings snapshot. */
export function resolveBlankTabModel(plugin: ObsiusPlugin): string {
  const snapshot = AgentSettingsCoordinator.getAgentSettingsSnapshot(
    plugin.settings as unknown as Record<string, unknown>,
  );
  return snapshot.model as string;
}

export type TabAgentSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

export function getTabCapabilities(tab: TabAgentContext): RuntimeCapabilities {
  return tab.service?.getCapabilities() ?? PiAgentServices.getCapabilities();
}

export function getTabChatUIConfig(
  _tab: TabAgentContext,
  _plugin: ObsiusPlugin,
  _conversation?: unknown,
): ChatUIConfig {
  return PiAgentServices.getChatUIConfig();
}

export function getTabSettingsSnapshot(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
): TabAgentSettings {
  return AgentSettingsCoordinator.getAgentSettingsSnapshot(
    plugin.settings,
  );
}

export function getTabPermissionMode(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === 'string' && permissionMode
    ? permissionMode
    : 'normal';
}

export function getTabHiddenCommands(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
  conversation?: unknown,
): Set<string> {
  return getHiddenSlashCommandSet(plugin.settings);
}

export function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<ObsiusSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {
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
  plugin: ObsiusPlugin,
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

export function refreshTabAgentUI(tab: TabData, plugin: ObsiusPlugin): void {
  const capabilities = getTabCapabilities(tab);
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.modeSelector?.updateDisplay();
  tab.ui.modeSelector?.renderOptions();
  tab.ui.thinkingBudgetSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'obsius2-input-plan-mode',
    permissionMode === 'plan' && capabilities.supportsPlanMode,
  );
}

export function applyCapabilityUIGating(tab: TabData): void {
  const capabilities = getTabCapabilities(tab);
  const uiConfig = PiAgentServices.getChatUIConfig();
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

export function syncTabAgentServices(
  tab: TabData,
  plugin: ObsiusPlugin,
): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = PiAgentServices.createInstructionRefineService(plugin);
  tab.services.subagentManager.setTaskResultInterpreter?.(
    PiAgentServices.getTaskResultInterpreter(),
  );
}

export function ensureTitleGenerationService(tab: TabData, plugin: ObsiusPlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = PiAgentServices.createTitleGenerationService(plugin);
  }
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === 'function') {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}
