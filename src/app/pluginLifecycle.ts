import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { Plugin } from 'obsidian';

import type { PiviPluginHost } from '@/app/hostContracts';
import type { ChatUiCompositionHost } from '@/app/ui/createUiPorts';
import { registerSelectionToolbarUi } from "@/app/ui/selectionToolbar/SelectionToolbarSurfaceController";

import { registerPiviCommands } from "./commandRegistration";
import { registerEditorSelectionToolbar } from "./editorSelectionToolbarRegistration";
import { isNoteToolbarTextToolbarActive } from "./noteToolbarIntegration";
import { registerPiviSettings } from "./settingsRegistration";
import { measureStartupPhase } from "./startupPerformance";
import { findAllPiviViews } from "./viewAccess";
import { registerPiviViews } from "./viewRegistration";

const logger = new PluginLogger('PluginLifecycle');

export async function initializePiviPlugin(
  owner: Plugin,
  host: PiviPluginHost & ChatUiCompositionHost,
): Promise<void> {
  await measureStartupPhase('settings', () => host.loadSettings());
  registerPiviViews(owner, host);
  registerPiviCommands(owner, host);
  registerPiviSettings(owner, host);
  registerEditorSelectionToolbar(owner, {
    isToolbarEnabled: () => (
      host.settings.editorSelectionToolbar?.enabled !== false
      && host.settings.editorSelectionToolbar.shortcuts.some(item => item.enabled)
    ),
    shouldYieldToNoteToolbar: () => isNoteToolbarTextToolbarActive(host.app),
  });
  registerSelectionToolbarUi(owner, host);

  host.app.workspace.onLayoutReady(() => {
    void host.ensureWorkspaceServices().catch((error: unknown) => {
      logger.error('Failed to initialize workspace services', error);
    });
  });
}

export async function persistOpenTabStates(
  plugin: Pick<PiviPluginHost, 'app'>,
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
