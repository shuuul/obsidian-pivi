import { AgentServices } from '../../../core/agent/AgentServices';
import { AgentSettingsCoordinator } from '../../../core/agent/AgentSettingsCoordinator';
import type ObsiusPlugin from '../../../main';
import { getTabCapabilities, getTabSettingsSnapshot } from './tabAgentContext';
import type { TabData } from './types';

export function updatePlanModeUI(tab: TabData, plugin: ObsiusPlugin, mode: string): void {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  const uiConfig = AgentServices.getChatUIConfig();
  if (uiConfig.applyPermissionMode) {
    uiConfig.applyPermissionMode(mode, snapshot);
  } else {
    snapshot.permissionMode = mode;
  }
  AgentSettingsCoordinator.commitAgentSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'obsius2-input-plan-mode',
    mode === 'plan' && getTabCapabilities(tab).supportsPlanMode,
  );
}
