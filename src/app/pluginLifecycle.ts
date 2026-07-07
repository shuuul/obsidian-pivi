import type PiviPlugin from "@/main"

import { findAllPiviViews } from "./viewAccess";

export async function initializePiviPlugin(plugin: PiviPlugin): Promise<void> {
  await plugin.loadSettings();
  await plugin.initializeWorkspaceServices();
}

export async function persistOpenTabStates(
  plugin: PiviPlugin,
): Promise<void> {
  // Ensures state is saved even if Obsidian quits without calling onClose().
  for (const view of findAllPiviViews(plugin.app)) {
    const tabManager = view.getTabManager();
    if (tabManager) {
      const state = tabManager.getPersistedState();
      await plugin.persistTabManagerState(state);
    }
  }
}
