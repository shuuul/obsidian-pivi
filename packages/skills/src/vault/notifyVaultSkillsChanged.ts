interface VaultSkillsRuntimeService {
  syncSystemPrompt?: () => Promise<void>;
}

interface VaultSkillsTabManager {
  invalidateSlashCommandCaches(): void;
  broadcastToAllTabs(
    callback: (service: VaultSkillsRuntimeService) => Promise<void>,
  ): Promise<void>;
}

interface VaultSkillsView {
  getTabManager(): VaultSkillsTabManager | null;
}

export interface VaultSkillsChangeNotifier {
  getAllViews(): VaultSkillsView[];
}

/** Refresh slash skill cache and Pi system prompt on all open chat tabs. */
export async function notifyVaultSkillsChanged(notifier: VaultSkillsChangeNotifier): Promise<void> {
  for (const view of notifier.getAllViews()) {
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
