import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import { ObsidianVaultApi } from "@pivi/obsidian-host";
import type { App, Plugin } from "obsidian";

import type { PiviApplicationFacades } from "@/app/hostContracts";
import { registerSelectionToolbarUi } from "@/app/ui/selectionToolbar/SelectionToolbarSurfaceController";

import { registerPiviCli } from "./cliRegistration";
import { registerPiviCommands } from "./commandRegistration";
import { registerEditorSelectionToolbar } from "./editorSelectionToolbarRegistration";
import { isNoteToolbarTextToolbarActive } from "./noteToolbarIntegration";
import { registerPiviSettings } from "./settingsRegistration";
import { measureStartupPhase } from "./startupPerformance";
import { findAllPiviViews } from "./viewAccess";
import { registerPiviViews } from "./viewRegistration";

const logger = new PluginLogger('PluginLifecycle');

/** One-shot vault adapter per operation, matching the hostPlatform pattern. */
const vaultApi = (app: App): ObsidianVaultApi => new ObsidianVaultApi(app);

export async function initializePiviPlugin(
  plugin: Plugin,
  facades: PiviApplicationFacades,
  loadSettings: () => Promise<void>,
): Promise<void> {
  await measureStartupPhase('settings', loadSettings);
  registerPiviViews(plugin, facades.chat, facades.sessions, facades.workspace);
  registerPiviCommands(plugin, facades.chat);
  registerPiviCli(plugin, {
    readNote: async (file, path) => {
      try {
        const result = await vaultApi(facades.chat.app).readNote(file, path);
        return {
          basename: result.path.split('/').pop()?.replace(/\.md$/i, '') ?? result.path,
          content: result.content,
        };
      } catch {
        return null;
      }
    },
    listWorkspaceEntries: async () => (
      await facades.workspace.ensureWorkspaceServices()).slashCommandCatalog.listWorkspaceEntries(),
    createAuxQueryRunner: () => facades.chat.createAuxQueryRunner(),
    getCliDefaultModel: () => facades.chat.settings.cliDefaultModel,
    today: () => new Date().toLocaleDateString(),
  });
  registerPiviSettings(plugin, facades.settings, facades.workspace);
  registerEditorSelectionToolbar(plugin, {
    isToolbarEnabled: () => (
      facades.integrations.settings.editorSelectionToolbar?.enabled !== false
      && facades.integrations.settings.editorSelectionToolbar.shortcuts.some(item => item.enabled)
    ),
    shouldYieldToNoteToolbar: () => isNoteToolbarTextToolbarActive(plugin.app),
  });
  registerSelectionToolbarUi(facades.integrations, cleanup => plugin.register(cleanup));

  plugin.app.workspace.onLayoutReady(() => {
    void facades.workspace.ensureWorkspaceServices().catch((error: unknown) => {
      logger.error('Failed to initialize workspace services', error);
    });
  });
}

export async function persistOpenTabStates(
  app: App,
): Promise<void> {
  // Ensures state is saved even if Obsidian quits without calling onClose().
  const persistOperations: Promise<void>[] = [];
  const errors: unknown[] = [];
  for (const view of findAllPiviViews(app)) {
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

export async function shutdownOpenChatViews(app: App): Promise<void> {
  const operations: Promise<void>[] = [];
  const errors: unknown[] = [];
  for (const view of findAllPiviViews(app)) {
    try {
      const maintenance = view.getChatHandle()?.maintenance;
      const operation = maintenance?.shutdown
        ? maintenance.shutdown()
        : maintenance?.persistState();
      if (operation) operations.push(operation);
    } catch (error) {
      errors.push(error);
    }
  }
  const results = await Promise.allSettled(operations);
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to shut down open Pivi chat views.');
  }
}
