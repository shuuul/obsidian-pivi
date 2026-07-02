import type { TabData } from './types';

/** Wire runtime callbacks after tab service and input controller exist. */
export function setupServiceCallbacks(tab: TabData): void {
  if (!tab.service || !tab.controllers.inputController) {
    return;
  }

  tab.service.setApprovalCallback(
    async (toolName, input, description, options) =>
      await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
      ?? 'cancel'
  );
}
