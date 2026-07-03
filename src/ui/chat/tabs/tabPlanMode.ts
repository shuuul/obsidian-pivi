import { piChatUIConfig } from '@pivi/pivi-agent-core/engine/pi/PiChatUIConfig';
import { PiSettingsCoordinator } from '@pivi/pivi-agent-core/engine/pi/PiSettingsCoordinator';

import type PiviPlugin from '@/app/PiviPluginHost';

import { getTabSettingsSnapshot } from './tabAgentContext';
import type { TabData } from './types';

export function updatePlanModeUI(tab: TabData, plugin: PiviPlugin, mode: string): void {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  const uiConfig = piChatUIConfig;
  if (uiConfig.applyPermissionMode) {
    uiConfig.applyPermissionMode(mode, snapshot);
  } else {
    snapshot.permissionMode = mode;
  }
  PiSettingsCoordinator.commitSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'pivi-input-plan-mode',
    mode === 'plan',
  );
}
