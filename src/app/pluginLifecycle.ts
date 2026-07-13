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
    await view.getChatHandle()?.maintenance.persistState();
  }
}
