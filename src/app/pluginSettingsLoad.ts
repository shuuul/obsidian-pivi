/**
 * Plugin settings load/reconcile path extracted from the Obsidian Plugin shell.
 */
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import { migratePiProviderCredentialsToKeychain } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import type { OpenSessionState, PiviSettings } from "@pivi/pivi-agent-core/foundation";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/pivi-agent-core/foundation/agentSettings";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type { SessionStore } from "@pivi/pivi-agent-core/session";
import type { OpenSessionManager } from "@pivi/pivi-agent-core/session/openSessionManager";
import {
  type DefaultVaultSkillsContext,
  ensureDefaultVaultSkills,
} from "@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills";
import type { App } from "obsidian";

import type { Locale } from "@/app/i18n";
import { setLocale } from "@/app/i18n";

import { getVaultPath } from "./hostPlatform";

export interface PluginSettingsLoadContext {
  app: App;
  storage: {
    initialize(): Promise<{ pivi: Partial<PiviSettings> }>;
    getAdapter(): FileStore;
  };
  sessionManager: OpenSessionManager;
  createSessionStore(vaultAdapter: FileStore, vaultPath: string): SessionStore;
  hideDeletedSessionSummaries(): Promise<void>;
  persistSessionSummary(openSession: OpenSessionState): Promise<void>;
  saveSettings(): Promise<void>;
  setSettings(settings: PiviSettings): void;
  setSessionStore(store: SessionStore | null): void;
  getSettings(): PiviSettings;
  getSessions(): OpenSessionState[];
  setLastKnownTabManagerState(state: unknown): void;
  getStorage(): { getTabManagerState(): Promise<unknown> };
  /** Host used for default vault skills install prompt and notification. */
  skillsHost: DefaultVaultSkillsContext;
}

export async function loadPluginSettings(
  ctx: PluginSettingsLoadContext,
): Promise<void> {
  const { pivi } = await ctx.storage.initialize();
  ctx.setLastKnownTabManagerState(await ctx.getStorage().getTabManagerState());

  const settings: PiviSettings = {
    ...DEFAULT_PIVI_SETTINGS,
    ...pivi,
  };
  ctx.setSettings(settings);

  const didReconcileModelSelections =
    PiSettingsCoordinator.reconcileTitleGenerationModelSelection(settings);
  await migrateProviderSecretsToKeychain(ctx);

  const vaultPath = getVaultPath(ctx.app);
  if (vaultPath) {
    ctx.setSessionStore(
      ctx.createSessionStore(ctx.storage.getAdapter(), vaultPath),
    );
  } else {
    ctx.setSessionStore(null);
  }

  await ctx.sessionManager.loadSummaries();
  await ctx.hideDeletedSessionSummaries();
  setLocale(settings.locale as Locale);

  const backfilledSessions = ctx.sessionManager.backfillSessionResponseTimestamps();
  const { changed, invalidatedSessions } = PiSettingsCoordinator.reconcileSettings(
    settings,
    ctx.getSessions(),
  );

  PiSettingsCoordinator.projectActivePiState(settings);

  if (changed || didReconcileModelSelections) {
    await ctx.saveSettings();
  }

  for (const conv of [...backfilledSessions, ...invalidatedSessions]) {
    await ctx.persistSessionSummary(conv);
  }

  void ensureDefaultVaultSkills(ctx.skillsHost).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Pivi: default vault skills install failed", message);
  });
}

async function migrateProviderSecretsToKeychain(
  ctx: PluginSettingsLoadContext,
): Promise<void> {
  if (!isSecretStorageAvailable(ctx.app.secretStorage)) {
    return;
  }

  const settings = ctx.getSettings();
  const settingsBag = settings as unknown as Record<string, unknown>;
  const piSettings = getPiAgentSettings(settingsBag);
  const synced = migratePiProviderCredentialsToKeychain(
    ctx.app.secretStorage,
    piSettings.addedProviders,
    piSettings.environmentVariables,
  );
  if (!synced.changed) {
    return;
  }

  // Migration may reorder/merge builtin credential providers; keep known custom ids.
  const customIds = new Set(piSettings.customProviders.map((provider) => provider.id));
  const addedProviders = [
    ...new Set([
      ...synced.addedProviders,
      ...piSettings.addedProviders.filter((id) => customIds.has(id)),
    ]),
  ];

  updatePiAgentSettings(settingsBag, {
    addedProviders,
    environmentVariables: synced.environmentVariables,
  });
  await ctx.saveSettings();
}
