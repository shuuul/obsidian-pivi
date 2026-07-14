import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';

import type PiviPlugin from "@/main"

import { registerPiviCommands } from "./commandRegistration";
import { registerPiviSettings } from "./settingsRegistration";
import { measureStartupPhase } from "./startupPerformance";
import { findAllPiviViews } from "./viewAccess";
import { registerPiviViews } from "./viewRegistration";

const logger = new PluginLogger('PluginLifecycle');

export async function initializePiviPlugin(plugin: PiviPlugin): Promise<void> {
  await measureStartupPhase('settings', () => plugin.loadSettings());
  registerPiviViews(plugin);
  registerPiviCommands(plugin);
  registerPiviSettings(plugin);

  plugin.app.workspace.onLayoutReady(() => {
    void plugin.ensureWorkspaceServices().catch((error: unknown) => {
      logger.error('Failed to initialize workspace services', error);
    });
  });
}

export async function persistOpenTabStates(
  plugin: PiviPlugin,
): Promise<void> {
  // Ensures state is saved even if Obsidian quits without calling onClose().
  const persistOperations: Promise<void>[] = [];
  const errors: unknown[] = [];
  for (const view of findAllPiviViews(plugin.app)) {
    try {
      const operation = view.getChatHandle()?.maintenance.persistState();
      if (operation) {
        persistOperations.push(operation);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  const results = await Promise.allSettled(persistOperations);
  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push(result.reason);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to persist open Pivi tab states.');
  }
}
