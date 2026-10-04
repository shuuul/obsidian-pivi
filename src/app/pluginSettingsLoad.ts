/**
 * Plugin settings load/reconcile path extracted from the Obsidian Plugin shell.
 */
import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import type { FileStore } from "@pivi/agent/ports";
import type { OpenSessionState } from "@pivi/agent/runtime";
import type { SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { PiviSettings } from "@pivi/agent/settings";
import {
  type DefaultVaultSkillsContext,
  ensureDefaultVaultSkills,
} from "@pivi/agent/skills/vault/ensureDefaultVaultSkills";
import {
  projectActivePiState,
  reconcilePiTitleGenerationModel,
} from "@pivi/engine-pi/application/models";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { getVaultPath } from "@pivi/obsidian-host/path";
import type { App } from "obsidian";
import { Notice } from "obsidian";

import { ObsidianDeviceLocalEnvironmentStore } from "@/app/deviceLocalEnvironmentStore";
import { ObsidianDeviceLocalProviderStore } from "@/app/deviceLocalProviderStore";
import { ObsidianDeviceLocalSessionJournalStore } from "@/app/deviceLocalSessionJournalStore";
import { cleanupEmptySessionsAtStartup } from "@/app/emptySessionCleanup";
import type { Locale } from "@/app/i18n";
import { setLocale, t } from "@/app/i18n";
import { relocateQueuedDeletedSessions } from "@/app/pluginSessionApi";
import { reconcileSessionCloudRecovery } from "@/app/serviceGraph";
import { loadDeviceLocalEnvironmentState } from "@/app/settings/deviceLocalEnvironmentLoad";
import { loadDeviceLocalProviderState } from "@/app/settings/deviceLocalProviderLoad";
import {
  type DeviceLocalCapabilityPermissions,
  type DeviceLocalExternalReadDirectories,
  overlayDeviceLocalCapabilityPermissions,
} from "@/app/settings/piviSettingsCodec";

const logger = new PluginLogger('PluginSettingsLoad');

export interface PluginSettingsLoadContext {
  app: App;
  storage: {
    initialize(): Promise<void>;
    loadRawPiviSettings(): Promise<Record<string, unknown> | null>;
    saveRawPiviSettings(stored: Record<string, unknown>): Promise<void>;
    getAdapter(): FileStore;
    takeDeletedSessionFileQueue(): Promise<string[]>;
  };
  sessionManager: OpenSessionManager;
  createSessionStore(vaultAdapter: FileStore, vaultPath: string): SessionStore;
  persistSessionSummary(openSession: OpenSessionState): Promise<void>;
  saveSettings(): Promise<void>;
  setSettings(settings: PiviSettings): void;
  setSessionStore(store: SessionStore | null): void;
  getSettings(): PiviSettings;
  getSessions(): OpenSessionState[];
  setLastKnownTabManagerState(state: unknown): void;
  getStorage(): {
    getTabManagerState(): Promise<unknown>;
    setTabManagerState?(state: unknown): Promise<void>;
  };
  /** Device-local Bash, command, and external-directory grants. */
  capabilityPermissions: DeviceLocalCapabilityPermissions;
  /** Pre-capability-store external directories; read once for migration. */
  legacyExternalContexts: DeviceLocalExternalReadDirectories;
  /** Host used for default vault skills install prompt and notification. */
  skillsHost: DefaultVaultSkillsContext;
}

export async function loadPluginSettings(
  ctx: PluginSettingsLoadContext,
): Promise<void> {
  await ctx.storage.initialize();
  const rawSettings = await ctx.storage.loadRawPiviSettings();
  const environmentStore = new ObsidianDeviceLocalEnvironmentStore(ctx.app);
  const environmentLoad = await loadDeviceLocalEnvironmentState({
    app: ctx.app,
    rawSettings,
    environmentStore,
    savePersistedSettings: (stored) => ctx.storage.saveRawPiviSettings(stored),
  });
  const deviceLocalStore = new ObsidianDeviceLocalProviderStore(ctx.app);
  const providerLoad = await loadDeviceLocalProviderState({
    app: ctx.app,
    rawSettings: await ctx.storage.loadRawPiviSettings(),
    deviceLocalStore,
    vaultAdapter: ctx.storage.getAdapter(),
    savePersistedSettings: (stored) => ctx.storage.saveRawPiviSettings(stored),
  });
  // Reconcile on the same object that is installed and later saved. Spreading
  // into setSettings first left title/active-model repairs on a discarded copy.
  const settings: PiviSettings = {
    ...providerLoad.settings,
    sharedEnvironmentVariables: environmentLoad.settings.sharedEnvironmentVariables,
    agentSettings: {
      ...providerLoad.settings.agentSettings,
      environmentVariables: environmentLoad.settings.agentSettings.environmentVariables,
    },
  };
  const didOverlayCapabilityPermissions = overlayDeviceLocalCapabilityPermissions(
    settings,
    rawSettings ?? {},
    ctx.capabilityPermissions,
    ctx.legacyExternalContexts,
  );
  const didReconcileModelSelections =
    reconcilePiTitleGenerationModel(settings);
  ctx.setSettings(settings);
  if (providerLoad.syncedSaveFailed || environmentLoad.syncedSaveFailed) {
    logger.warn(
      'Device-local state committed, but synced settings save failed during startup load',
    );
    new Notice(t('host.failedSaveSyncedSettings'));
  }
  ctx.setLastKnownTabManagerState(await ctx.getStorage().getTabManagerState());

  const vaultPath = getVaultPath(ctx.app);
  if (vaultPath) {
    const journalStore = new ObsidianDeviceLocalSessionJournalStore(ctx.app);
    reconcileSessionCloudRecovery(ctx.app, vaultPath, journalStore);
    const sessionStore = ctx.createSessionStore(ctx.storage.getAdapter(), vaultPath);
    if (!sessionStore.migrateDeviceLocalExternalContexts) {
      throw new Error('Session store does not support device-local external context migration');
    }
    await sessionStore.migrateDeviceLocalExternalContexts();
    await relocateQueuedDeletedSessions(
      () => ctx.storage.takeDeletedSessionFileQueue(),
      sessionStore,
    );
    await cleanupEmptySessionsAtStartup({
      sessionStore,
      vaultPath,
      journalStore,
      getTabManagerState: async () => (
        await ctx.getStorage().getTabManagerState() as AppTabManagerState | null
      ),
      setTabManagerState: async (state) => {
        await ctx.getStorage().setTabManagerState?.(state);
        ctx.setLastKnownTabManagerState(state);
      },
    });
    ctx.setSessionStore(sessionStore);
  } else {
    ctx.setSessionStore(null);
  }

  await ctx.sessionManager.loadSummaries();
  setLocale(settings.locale as Locale);

  const installed = ctx.getSettings();
  const backfilledSessions = ctx.sessionManager.backfillSessionResponseTimestamps();
  const changed = reconcilePiTitleGenerationModel(installed);

  const modelBeforeProject = installed.model;
  projectActivePiState(installed);
  const didRepairActiveModel = installed.model !== modelBeforeProject;

  if (
    changed
    || didOverlayCapabilityPermissions
    || didReconcileModelSelections
    || didRepairActiveModel
  ) {
    await ctx.saveSettings();
  }

  for (const conv of backfilledSessions) {
    await ctx.persistSessionSummary(conv);
  }

  void ensureDefaultVaultSkills(ctx.skillsHost).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Default vault skills install failed", message);
  });
}
