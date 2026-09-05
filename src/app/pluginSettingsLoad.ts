/**
 * Plugin settings load/reconcile path extracted from the Obsidian Plugin shell.
 */
import { isSecretStorageAvailable } from "@pivi/agent/auth/providerSecretStorage";
import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import type { FileStore } from "@pivi/agent/ports";
import type { OpenSessionState } from "@pivi/agent/runtime";
import type { SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { PiviSettings } from "@pivi/agent/settings";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/agent/settings/agentSettings";
import {
  type DefaultVaultSkillsContext,
  ensureDefaultVaultSkills,
} from "@pivi/agent/skills/vault/ensureDefaultVaultSkills";
import {
  migrateMembershipAwareProviderSecrets,
} from "@pivi/engine-pi/application/auth";
import {
  PiSettingsCoordinator,
} from "@pivi/engine-pi/application/models";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
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
import { runDeviceLocalEnvironmentMigration } from "@/app/settings/deviceLocalEnvironmentMigration";
import { runDeviceLocalProviderMigration } from "@/app/settings/deviceLocalProviderMigration";

import { getVaultPath } from "./hostPlatform";

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
  /** Host used for default vault skills install prompt and notification. */
  skillsHost: DefaultVaultSkillsContext;
}

export async function loadPluginSettings(
  ctx: PluginSettingsLoadContext,
): Promise<void> {
  await ctx.storage.initialize();
  const rawSettings = await ctx.storage.loadRawPiviSettings();
  const environmentStore = new ObsidianDeviceLocalEnvironmentStore(ctx.app);
  const environmentMigration = await runDeviceLocalEnvironmentMigration({
    app: ctx.app,
    rawSettings,
    environmentStore,
    savePersistedSettings: (stored) => ctx.storage.saveRawPiviSettings(stored),
  });
  const deviceLocalStore = new ObsidianDeviceLocalProviderStore(ctx.app);
  const migration = await runDeviceLocalProviderMigration({
    app: ctx.app,
    rawSettings: await ctx.storage.loadRawPiviSettings(),
    deviceLocalStore,
    vaultAdapter: ctx.storage.getAdapter(),
    savePersistedSettings: (stored) => ctx.storage.saveRawPiviSettings(stored),
  });
  ctx.setSettings({
    ...migration.settings,
    sharedEnvironmentVariables: environmentMigration.settings.sharedEnvironmentVariables,
    agentSettings: {
      ...migration.settings.agentSettings,
      environmentVariables: environmentMigration.settings.agentSettings.environmentVariables,
    },
  });
  if (migration.syncedSaveFailed || environmentMigration.syncedSaveFailed) {
    logger.warn(
      'Device-local state committed, but synced settings save failed during migration',
    );
    new Notice(t('host.failedSaveSyncedSettings'));
  }
  ctx.setLastKnownTabManagerState(await ctx.getStorage().getTabManagerState());

  const didReconcileModelSelections =
    PiSettingsCoordinator.reconcileTitleGenerationModelSelection(migration.settings);
  const didMigrateProviderSecrets = migration.credentialsMigrated
    || environmentMigration.credentialsMigrated
    || migrateProviderSecretsToKeychain(ctx);

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
  setLocale(migration.settings.locale as Locale);

  const backfilledSessions = ctx.sessionManager.backfillSessionResponseTimestamps();
  const { changed, invalidatedSessions } = PiSettingsCoordinator.reconcileSettings(
    migration.settings,
    ctx.getSessions(),
  );

  PiSettingsCoordinator.projectActivePiState(migration.settings);

  if (changed || didReconcileModelSelections || didMigrateProviderSecrets) {
    await ctx.saveSettings();
  }

  for (const conv of [...backfilledSessions, ...invalidatedSessions]) {
    await ctx.persistSessionSummary(conv);
  }

  void ensureDefaultVaultSkills(ctx.skillsHost).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Default vault skills install failed", message);
  });
}

export function migrateProviderSecretsToKeychain(
  ctx: PluginSettingsLoadContext,
): boolean {
  if (!isSecretStorageAvailable(ctx.app.secretStorage)) {
    return false;
  }

  const settings = ctx.getSettings();
  const settingsBag = settings as unknown as Record<string, unknown>;
  const piSettings = getPiAgentSettings(settingsBag);
  const migrated = migrateMembershipAwareProviderSecrets(
    ctx.app.secretStorage,
    {
      addedProviders: piSettings.addedProviders,
      disabledProviders: piSettings.disabledProviders,
      environmentVariables: piSettings.environmentVariables,
      visibleModels: piSettings.visibleModels,
      model: settings.model,
      titleGenerationModel: settings.titleGenerationModel,
      ...(typeof settings.agentSettings.lastModel === 'string'
        ? { lastModel: settings.agentSettings.lastModel }
        : {}),
      customProviders: piSettings.customProviders,
    },
  );

  updatePiAgentSettings(settingsBag, {
    addedProviders: [...migrated.membership.addedProviders],
    disabledProviders: [...migrated.membership.disabledProviders],
    environmentVariables: migrated.membership.environmentVariables,
    visibleModels: [...migrated.membership.visibleModels],
  });
  settings.model = migrated.membership.model;
  settings.titleGenerationModel = migrated.membership.titleGenerationModel;
  if (migrated.membership.lastModel) {
    settings.agentSettings.lastModel = migrated.membership.lastModel;
  }
  return migrated.changed;
}
