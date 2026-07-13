import type PiviPlugin from "@/main"

import { registerPiviCommands } from "./commandRegistration";
import { registerPiviSettings } from "./settingsRegistration";
import { measureStartupPhase } from "./startupPerformance";
import { findAllPiviViews } from "./viewAccess";
import { registerPiviViews } from "./viewRegistration";

export async function initializePiviPlugin(plugin: PiviPlugin): Promise<void> {
  await measureStartupPhase('settings', () => plugin.loadSettings());
  registerPiviViews(plugin);
  registerPiviCommands(plugin);
  registerPiviSettings(plugin);

  plugin.app.workspace.onLayoutReady(() => {
    void plugin.ensureWorkspaceServices().catch((error: unknown) => {
      console.error('Pivi: failed to initialize workspace services', error);
    });
  });
}

export async function persistOpenTabStates(
  plugin: PiviPlugin,
): Promise<void> {
  // Ensures state is saved even if Obsidian quits without calling onClose().
  for (const view of findAllPiviViews(plugin.app)) {
    await view.getChatHandle()?.maintenance.persistState();
  }
}
