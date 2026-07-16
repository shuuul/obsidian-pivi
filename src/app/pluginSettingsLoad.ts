/**
 * Plugin settings load/reconcile path extracted from the Obsidian Plugin shell.
 */
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import {
  migratePiProviderCredentialsToKeychain,
  migrateSplitSubscriptionOAuthCredentials,
} from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import type { OpenSessionState, PiviSettings } from "@pivi/pivi-agent-core/foundation";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/pivi-agent-core/foundation/agentSettings";
import { PluginLogger } from "@pivi/pivi-agent-core/foundation/pluginLogger";
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

const logger = new PluginLogger('PluginSettingsLoad');

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
  const didMigrateProviderSecrets = migrateProviderSecretsToKeychain(ctx);

  const vaultPath = getVaultPath(ctx.app);
  if (vaultPath) {
    const sessionStore = ctx.createSessionStore(ctx.storage.getAdapter(), vaultPath);
    if (!sessionStore.migrateDeviceLocalExternalContexts) {
      throw new Error('Session store does not support device-local external context migration');
    }
    await sessionStore.migrateDeviceLocalExternalContexts();
    ctx.setSessionStore(sessionStore);
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
  // Split canonical OAuth first so a backing-provider API key from the
  // environment can migrate without overwriting the plan credential.
  const preSplit = migrateSplitSubscriptionOAuthCredentials(
    ctx.app.secretStorage,
    piSettings.addedProviders,
  );
  const synced = migratePiProviderCredentialsToKeychain(
    ctx.app.secretStorage,
    preSplit.addedProviders,
    piSettings.environmentVariables,
  );
  // Legacy credential formats become canonical in the generic pass, so run
  // the idempotent split once more to catch a migrated legacy OAuth value.
  const postSplit = migrateSplitSubscriptionOAuthCredentials(
    ctx.app.secretStorage,
    synced.addedProviders,
  );
  const migratedPiProviderIds = [
    ...new Set([
      ...preSplit.migratedPiProviderIds,
      ...postSplit.migratedPiProviderIds,
    ]),
  ];

  const providerRewrites = new Map<string, string>();
  const ambiguousProviderSplits = new Set<string>();
  if (migratedPiProviderIds.includes('xai')) {
    providerRewrites.set('xai', 'grok-build');
    if (piSettings.addedProviders.includes('xai') && piSettings.addedProviders.includes('grok-build')) {
      ambiguousProviderSplits.add('xai');
    }
  }
  if (migratedPiProviderIds.includes('anthropic')) {
    providerRewrites.set('anthropic', 'claude');
    if (piSettings.addedProviders.includes('anthropic') && piSettings.addedProviders.includes('claude')) {
      ambiguousProviderSplits.add('anthropic');
    }
  }

  const toSubscriptionModelKey = (modelKey: string): string => {
    const slashIndex = modelKey.indexOf('/');
    if (slashIndex < 1) {
      return modelKey;
    }
    const providerId = modelKey.substring(0, slashIndex);
    const nextProviderId = providerRewrites.get(providerId);
    if (providerId === 'xai' && nextProviderId === 'grok-build') {
      return 'grok-build/grok-composer-2.5-fast';
    }
    return nextProviderId
      ? `${nextProviderId}${modelKey.substring(slashIndex)}`
      : modelKey;
  };
  const rewriteModelKey = (modelKey: string): string => {
    const providerId = modelKey.substring(0, modelKey.indexOf('/'));
    return ambiguousProviderSplits.has(providerId)
      ? modelKey
      : toSubscriptionModelKey(modelKey);
  };

  const visibleModels = piSettings.visibleModels.map(rewriteModelKey);
  for (const modelKey of piSettings.visibleModels) {
    const providerId = modelKey.substring(0, modelKey.indexOf('/'));
    if (ambiguousProviderSplits.has(providerId)) {
      visibleModels.push(toSubscriptionModelKey(modelKey));
    }
  }

  const nextDisabledProviders = piSettings.disabledProviders.flatMap((providerId) => {
    const replacement = providerRewrites.get(providerId);
    return replacement && !ambiguousProviderSplits.has(providerId)
      ? [replacement]
      : [providerId];
  });

  updatePiAgentSettings(settingsBag, {
    addedProviders: postSplit.addedProviders,
    disabledProviders: [...new Set(nextDisabledProviders)],
    environmentVariables: synced.environmentVariables,
    visibleModels: [...new Set(visibleModels)],
  });
  settings.model = rewriteModelKey(settings.model);
  settings.titleGenerationModel = rewriteModelKey(settings.titleGenerationModel);
  return preSplit.changed || synced.changed || postSplit.changed;
}
