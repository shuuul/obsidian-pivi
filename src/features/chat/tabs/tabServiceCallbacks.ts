import type PiviPlugin from '../../../main';
import { getTabPermissionMode } from './tabAgentContext';
import { renderAutoTriggeredTurn } from './tabAutoTurn';
import { updatePlanModeUI } from './tabPlanMode';
import type { TabData } from './types';

/** Wire runtime callbacks after tab service and input controller exist. */
export function setupServiceCallbacks(
  tab: TabData,
  plugin: PiviPlugin,
): void {
  if (!tab.service || !tab.controllers.inputController) {
    return;
  }

  tab.service.setApprovalCallback(
    async (toolName, input, description, options) =>
      await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
      ?? 'cancel'
  );
  tab.service.setApprovalDismisser(
    () => tab.controllers.inputController?.dismissPendingApprovalPrompt()
  );
  tab.service.setAskUserQuestionCallback(
    async (input, signal) =>
      await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
      ?? null
  );
  tab.service.setExitPlanModeCallback(
    async (input, signal) => {
      const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
      if (decision !== null && decision.type !== 'feedback') {
        if (getTabPermissionMode(tab, plugin) === 'plan') {
          const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
          tab.state.prePlanPermissionMode = null;
          updatePlanModeUI(tab, plugin, restoreMode);
        }
        if (decision.type === 'approve-new-session') {
          tab.state.pendingNewSessionPlan = decision.planContent;
          tab.state.cancelRequested = true;
        }
      }
      return decision;
    }
  );
  tab.service.setSubagentHookState(
    () => ({
      hasRunning: tab.services.subagentManager.hasRunningSubagents(),
    })
  );
  tab.service.setAutoTurnCallback((result) => renderAutoTriggeredTurn(tab, result));
  tab.service.setPermissionModeSyncCallback((runtimeMode) => {
    const mode = runtimeMode === 'plan' ? 'plan' : 'normal';
    const currentMode = getTabPermissionMode(tab, plugin);

    if (currentMode !== mode) {
      if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
        tab.state.prePlanPermissionMode = currentMode;
      }
      updatePlanModeUI(tab, plugin, mode);
    }
  });
}
