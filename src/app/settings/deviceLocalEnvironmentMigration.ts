/**
 * Idempotent migration of free-form synced environment text into the
 * device-local structured registry + SecretStorage / canonical credential stores.
 */

import { isSecretStorageAvailable } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import {
  migratePiProviderCredentialsToKeychain,
} from '@pivi/pivi-agent-core/engine/pi';
import type { DeviceLocalEnvironmentStore } from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import {
  buildEntriesFromLegacyText,
  clearObsoleteEnvironmentSecrets,
  createEmptyDeviceLocalEnvironmentState,
  createSecretStoreResolveHost,
  environmentStatesEqual,
  extractCanonicalCredentialCandidates,
  hasPersistedEnvironmentFields,
  projectEnvironmentOntoSettings,
  stageEnvironmentSecrets,
  stripEnvironmentFieldsFromPersistedSettings,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getAgentEnvironmentVariables,
  getSharedEnvironmentVariables,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';
import { createWebSearchCredentialStore } from '@pivi/pivi-agent-core/tools/webSearch/credentialStore';
import type { App } from 'obsidian';

import { normalizeStoredPiviSettings } from '@/app/settings/piviSettingsCodec';

const logger = new PluginLogger('DeviceLocalEnvironmentMigration');

export class DeviceLocalEnvironmentMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceLocalEnvironmentMigrationError';
  }
}

export interface DeviceLocalEnvironmentMigrationContext {
  app: App;
  rawSettings: Record<string, unknown> | null;
  environmentStore: DeviceLocalEnvironmentStore;
  savePersistedSettings(settings: Record<string, unknown>): Promise<void>;
  /** Optional process env lookup for systemEnvironment projection. */
  getSystemEnvironmentVariable?(name: string): string | undefined;
}

export interface DeviceLocalEnvironmentMigrationResult {
  settings: PiviSettings;
  cutoverPerformed: boolean;
  credentialsMigrated: boolean;
  syncedSaveFailed?: boolean;
}

function requireSecretStorage(app: App): SyncSecretStore {
  if (!isSecretStorageAvailable(app.secretStorage)) {
    throw new DeviceLocalEnvironmentMigrationError(
      'SecretStorage is unavailable; environment migration cannot continue.',
    );
  }
  return app.secretStorage;
}

function readLegacyEnvironmentTexts(
  raw: Record<string, unknown> | null,
): { shared: string; agent: string } {
  if (!raw) {
    return { shared: '', agent: '' };
  }
  return {
    shared: getSharedEnvironmentVariables(raw),
    agent: getAgentEnvironmentVariables(raw),
  };
}

function migrateCanonicalCredentialsFromText(
  secretStorage: SyncSecretStore,
  envText: string,
  addedProviders: readonly string[],
): { remainingText: string; changed: boolean } {
  const { providerEnv, webCredentials, remainingText } = extractCanonicalCredentialCandidates(envText);
  let changed = false;

  const providerText = Object.entries(providerEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  if (providerText) {
    const synced = migratePiProviderCredentialsToKeychain(
      secretStorage,
      addedProviders,
      providerText,
    );
    changed = changed || synced.changed;
  }

  const webStore = createWebSearchCredentialStore(secretStorage);
  if (webStore) {
    for (const { providerId, apiKey } of webCredentials) {
      const existing = webStore.readSync(providerId);
      if (!existing) {
        webStore.writeSync(providerId, apiKey);
        changed = true;
      } else if (existing !== apiKey) {
        // Keep existing canonical value; still remove from env text via remainingText.
        changed = true;
      } else {
        changed = true;
      }
    }
  } else if (webCredentials.length > 0) {
    throw new DeviceLocalEnvironmentMigrationError(
      'Web credentials require SecretStorage during environment migration.',
    );
  }

  return { remainingText, changed };
}

async function stripSyncedEnvironmentFields(
  ctx: DeviceLocalEnvironmentMigrationContext,
  runtimeSettings: PiviSettings,
): Promise<boolean> {
  const persisted = { ...runtimeSettings } as unknown as Record<string, unknown>;
  stripEnvironmentFieldsFromPersistedSettings(persisted);
  // Also strip from nested agentSettings copy on the runtime object projection.
  const agentSettings = {
    ...(runtimeSettings.agentSettings as unknown as Record<string, unknown>),
  };
  delete agentSettings.environmentVariables;
  persisted.agentSettings = agentSettings;
  delete persisted.sharedEnvironmentVariables;
  delete persisted.environmentVariables;

  try {
    await ctx.savePersistedSettings(persisted);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      'Device-local environment state committed, but synced settings save failed',
      message,
    );
    return true;
  }
}

/**
 * Startup cutover: legacy synced env text → local structured registry + secrets.
 * Source plaintext is removed from synced settings only after local publication succeeds.
 */
export async function runDeviceLocalEnvironmentMigration(
  ctx: DeviceLocalEnvironmentMigrationContext,
): Promise<DeviceLocalEnvironmentMigrationResult> {
  const raw = ctx.rawSettings;
  const baseSettings = normalizeStoredPiviSettings(raw ?? {}).settings;
  const getSystem = (name: string): string | undefined => {
    if (ctx.getSystemEnvironmentVariable) {
      return ctx.getSystemEnvironmentVariable(name);
    }
    try {
      return process.env[name];
    } catch {
      return undefined;
    }
  };

  const existing = ctx.environmentStore.loadInitialized();
  if (existing) {
    const secretStorage = isSecretStorageAvailable(ctx.app.secretStorage)
      ? ctx.app.secretStorage
      : undefined;
    const host = createSecretStoreResolveHost(secretStorage, getSystem);
    projectEnvironmentOntoSettings(baseSettings, existing, host);

    let syncedSaveFailed = false;
    let cutoverPerformed = false;
    if (raw && hasPersistedEnvironmentFields(raw)) {
      // Local already initialized: strip residual synced plaintext idempotently.
      syncedSaveFailed = await stripSyncedEnvironmentFields(ctx, baseSettings);
      cutoverPerformed = true;
    }

    return {
      settings: baseSettings,
      cutoverPerformed,
      credentialsMigrated: false,
      syncedSaveFailed,
    };
  }

  const legacy = readLegacyEnvironmentTexts(raw);
  const hasLegacy = legacy.shared.length > 0 || legacy.agent.length > 0;

  if (!hasLegacy) {
    const empty = createEmptyDeviceLocalEnvironmentState();
    ctx.environmentStore.save(empty);
    const host = createSecretStoreResolveHost(undefined, getSystem);
    projectEnvironmentOntoSettings(baseSettings, empty, host);
    let syncedSaveFailed = false;
    if (raw && (
      Object.hasOwn(raw, 'sharedEnvironmentVariables')
      || Object.hasOwn(raw, 'environmentVariables')
      || (
        raw.agentSettings
        && typeof raw.agentSettings === 'object'
        && !Array.isArray(raw.agentSettings)
        && Object.hasOwn(raw.agentSettings, 'environmentVariables')
      )
    )) {
      syncedSaveFailed = await stripSyncedEnvironmentFields(ctx, baseSettings);
    }
    return {
      settings: baseSettings,
      cutoverPerformed: true,
      credentialsMigrated: false,
      syncedSaveFailed,
    };
  }

  const secretStorage = requireSecretStorage(ctx.app);
  const addedProviders = baseSettings.agentSettings.addedProviders ?? [];

  const sharedCreds = migrateCanonicalCredentialsFromText(
    secretStorage,
    legacy.shared,
    addedProviders,
  );
  const agentCreds = migrateCanonicalCredentialsFromText(
    secretStorage,
    legacy.agent,
    addedProviders,
  );
  const credentialsMigrated = sharedCreds.changed || agentCreds.changed;

  const drafts = buildEntriesFromLegacyText(
    sharedCreds.remainingText,
    agentCreds.remainingText,
  );

  const staged = stageEnvironmentSecrets(secretStorage, drafts, null);
  // Publish local registry only after secrets for new entries are staged.
  ctx.environmentStore.save(staged.nextState);

  const host = createSecretStoreResolveHost(secretStorage, getSystem);
  projectEnvironmentOntoSettings(baseSettings, staged.nextState, host);

  const syncedSaveFailed = await stripSyncedEnvironmentFields(ctx, baseSettings);

  return {
    settings: baseSettings,
    cutoverPerformed: true,
    credentialsMigrated,
    syncedSaveFailed,
  };
}

/**
 * Steady-state save of structured environment drafts.
 * Stages secrets → writes local registry → clears obsolete secrets.
 */
export function publishEnvironmentEntries(
  secretStorageHost: { secretStorage?: SyncSecretStore },
  environmentStore: DeviceLocalEnvironmentStore,
  drafts: Parameters<typeof stageEnvironmentSecrets>[1],
): void {
  if (!isSecretStorageAvailable(secretStorageHost.secretStorage)) {
    throw new DeviceLocalEnvironmentMigrationError(
      'SecretStorage is unavailable; environment migration cannot continue.',
    );
  }
  const secretStorage = secretStorageHost.secretStorage;
  const previous = environmentStore.loadInitialized();
  const staged = stageEnvironmentSecrets(secretStorage, drafts, previous);
  environmentStore.save(staged.nextState);
  if (previous && environmentStatesEqual(previous, staged.nextState)
    && staged.obsoleteSecretIds.length === 0
    && staged.stagedSecretIds.length === 0) {
    return;
  }
  // Obsolete secrets cleared only after local config publication.
  clearObsoleteEnvironmentSecrets(secretStorage, staged.obsoleteSecretIds);
}
