/**
 * Idempotent migration of free-form synced environment text into the
 * device-local structured registry + SecretStorage / canonical credential stores.
 */

import { isSecretStorageAvailable } from '@pivi/agent/auth/providerSecretStorage';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { SyncSecretStore } from '@pivi/agent/ports';
import type { DeviceLocalEnvironmentStore } from '@pivi/agent/settings/deviceLocalEnvironmentState';
import {
  clearObsoleteEnvironmentSecrets,
  createEmptyDeviceLocalEnvironmentState,
  createSecretStoreResolveHost,
  environmentStatesEqual,
  extractCanonicalCredentialCandidates,
  hasPersistedEnvironmentFields,
  projectEnvironmentOntoSettings,
  stageEnvironmentSecrets,
  stripEnvironmentFieldsFromPersistedSettings,
} from '@pivi/agent/settings/deviceLocalEnvironmentState';
import type { PiviSettings } from '@pivi/agent/settings/types';
import { createWebSearchCredentialStore } from '@pivi/agent/tools/webSearch/credentialStore';
import {
  migratePiProviderCredentialsToKeychain,
} from '@pivi/engine-pi/application/auth';
import type { App } from 'obsidian';

import { normalizeStoredPiviSettings } from '@/app/settings/piviSettingsCodec';

const logger = new PluginLogger('DeviceLocalEnvironmentMigration');

class DeviceLocalEnvironmentMigrationError extends Error {
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
  syncedSaveFailed?: boolean;
}

export function migrateCanonicalCredentialsFromText(
  secretStorage: SyncSecretStore,
  envText: string,
  addedProviders: readonly string[],
  options: { overwriteWebCredentials?: boolean } = {},
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
    if (synced.environmentVariables.trim()) {
      throw new DeviceLocalEnvironmentMigrationError(
        'Provider credentials could not be handed off because their provider is not configured.',
      );
    }
    changed = changed || synced.changed;
  }

  const webStore = createWebSearchCredentialStore(secretStorage);
  if (webStore) {
    for (const { providerId, apiKey } of webCredentials) {
      const existing = webStore.readSync(providerId);
      if (!existing || options.overwriteWebCredentials) {
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
 * Startup load: project the device-local environment registry onto settings and
 * strip any environment text an older device synced back.
 */
export async function runDeviceLocalEnvironmentMigration(
  ctx: DeviceLocalEnvironmentMigrationContext,
): Promise<DeviceLocalEnvironmentMigrationResult> {
  const raw = ctx.rawSettings;
  const baseSettings = normalizeStoredPiviSettings(raw ?? {});
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
      syncedSaveFailed,
    };
  }

  // First run on this device. Environment text left in synced settings by a
  // release older than 0.15.0 is not migrated; it is stripped on save.
  const empty = createEmptyDeviceLocalEnvironmentState();
  ctx.environmentStore.save(empty);
  projectEnvironmentOntoSettings(
    baseSettings,
    empty,
    createSecretStoreResolveHost(undefined, getSystem),
  );
  const syncedSaveFailed = raw && hasPersistedEnvironmentFields(raw)
    ? await stripSyncedEnvironmentFields(ctx, baseSettings)
    : false;
  return {
    settings: baseSettings,
    cutoverPerformed: true,
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
