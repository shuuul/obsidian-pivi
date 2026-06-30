import type PiviPlugin from '../../main';

/** Refresh slash skill cache and Pi system prompt on all open chat tabs. */
export async function notifyVaultSkillsChanged(plugin: PiviPlugin): Promise<void> {
  for (const view of plugin.getAllViews()) {
    const tabManager = view.getTabManager();
    if (!tabManager) {
      continue;
    }

    tabManager.invalidateSlashCommandCaches();
    await tabManager.broadcastToAllTabs(async (service) => {
      if (service.syncSystemPrompt) {
        await service.syncSystemPrompt();
      }
    });
  }
}
