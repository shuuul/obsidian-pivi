import { isSecretStorageAvailable } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import {
  migrateMembershipAwareProviderSecrets,
} from '@pivi/pivi-agent-core/engine/pi';
import type { DeviceLocalProviderStore } from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';
import {
  DeviceLocalProviderStateVersionError,
  normalizeDeviceLocalProviderState,
  overlayDeviceLocalProviderState,
  seedDefaultDeviceLocalProviderState,
  stripLocalizedFieldsFromRuntimeSettings,
} from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation/settings';
import { migrateMcpAuthEntriesToSecretStorage } from '@pivi/pivi-agent-core/mcp/oauth/mcpAuthEntryMigration';
import { PIVI_MCP_CONFIG_PATH } from '@pivi/pivi-agent-core/mcp/paths';
import type { FileStore, SyncSecretStore } from '@pivi/pivi-agent-core/ports';
import type { App } from 'obsidian';

import {
  migrateCustomProviderHeadersToSecretStorage,
} from '@/app/settings/customProviderHeaderMigration';
import {
  buildDeviceLocalStateInputFromLegacy,
  hasLegacyProviderFields,
  snapshotLegacyProviderMembership,
} from '@/app/settings/legacyProviderSnapshot';
import { normalizeStoredPiviSettings } from '@/app/settings/piviSettingsCodec';

const logger = new PluginLogger('DeviceLocalProviderMigration');

export class DeviceLocalProviderMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceLocalProviderMigrationError';
  }
}

export interface DeviceLocalProviderMigrationContext {
  app: App;
  rawSettings: Record<string, unknown> | null;
  deviceLocalStore: DeviceLocalProviderStore;
  vaultAdapter: FileStore;
  savePersistedSettings(settings: Record<string, unknown>): Promise<void>;
}

export interface DeviceLocalProviderMigrationResult {
  settings: PiviSettings;
  cutoverPerformed: boolean;
  credentialsMigrated: boolean;
  syncedSaveFailed?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireSecretStorage(app: App): SyncSecretStore {
  if (!isSecretStorageAvailable(app.secretStorage)) {
    throw new DeviceLocalProviderMigrationError(
      'SecretStorage is unavailable; provider migration cannot continue.',
    );
  }
  return app.secretStorage;
}

function buildPortableRuntimeSettings(raw: Record<string, unknown>): PiviSettings {
  const { settings } = normalizeStoredPiviSettings(raw);
  return settings;
}

async function listMcpServerNames(adapter: FileStore): Promise<string[]> {
  if (!(await adapter.exists(PIVI_MCP_CONFIG_PATH))) {
    return [];
  }
  try {
    const content = await adapter.read(PIVI_MCP_CONFIG_PATH);
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      return [];
    }
    const servers = parsed.mcpServers;
    if (!isRecord(servers)) {
      return [];
    }
    return Object.keys(servers);
  } catch {
    return [];
  }
}

async function migrateMcpAuthEntriesIfPossible(
  ctx: DeviceLocalProviderMigrationContext,
): Promise<void> {
  if (!isSecretStorageAvailable(ctx.app.secretStorage)) {
    return;
  }
  const mcpServerNames = await listMcpServerNames(ctx.vaultAdapter);
  await migrateMcpAuthEntriesToSecretStorage(
    ctx.vaultAdapter,
    ctx.app.secretStorage,
    mcpServerNames,
  );
}

async function stripSyncedLocalizedFields(
  ctx: DeviceLocalProviderMigrationContext,
  runtimeSettings: PiviSettings,
): Promise<boolean> {
  const persisted = stripLocalizedFieldsFromRuntimeSettings(runtimeSettings);
  try {
    await ctx.savePersistedSettings(persisted);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      'Device-local provider state committed, but synced settings save failed',
      message,
    );
    return true;
  }
}

async function commitCutover(
  ctx: DeviceLocalProviderMigrationContext,
  localState: ReturnType<typeof normalizeDeviceLocalProviderState>,
  runtimeSettings: PiviSettings,
): Promise<{ syncedSaveFailed: boolean }> {
  try {
    ctx.deviceLocalStore.save(localState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DeviceLocalProviderMigrationError(
      `Failed to save device-local provider state: ${message}`,
    );
  }

  const syncedSaveFailed = await stripSyncedLocalizedFields(ctx, runtimeSettings);
  return { syncedSaveFailed };
}

function buildRuntimeSettingsFromLocalState(
  raw: Record<string, unknown>,
  localState: ReturnType<typeof normalizeDeviceLocalProviderState>,
): PiviSettings {
  const settings = buildPortableRuntimeSettings(raw);
  overlayDeviceLocalProviderState(settings, localState);
  return settings;
}

export async function runDeviceLocalProviderMigration(
  ctx: DeviceLocalProviderMigrationContext,
): Promise<DeviceLocalProviderMigrationResult> {
  let initializedState;
  try {
    initializedState = ctx.deviceLocalStore.loadInitialized();
  } catch (error) {
    if (error instanceof DeviceLocalProviderStateVersionError) {
      throw new DeviceLocalProviderMigrationError(
        'Unsupported device-local provider state version. Update Pivi or restore the local provider cache before retrying.',
      );
    }
    throw error;
  }

  const raw = ctx.rawSettings ?? {};

  if (initializedState) {
    const settings = buildRuntimeSettingsFromLocalState(raw, initializedState);
    await migrateMcpAuthEntriesIfPossible(ctx);
    let syncedSaveFailed = false;
    if (hasLegacyProviderFields(raw)) {
      syncedSaveFailed = await stripSyncedLocalizedFields(ctx, settings);
    }
    return {
      settings,
      cutoverPerformed: false,
      credentialsMigrated: false,
      ...(syncedSaveFailed ? { syncedSaveFailed: true } : {}),
    };
  }

  if (!hasLegacyProviderFields(raw)) {
    const localState = seedDefaultDeviceLocalProviderState();
    const settings = buildRuntimeSettingsFromLocalState(raw, localState);
    await migrateMcpAuthEntriesIfPossible(ctx);
    const cutover = await commitCutover(ctx, localState, settings);
    return {
      settings,
      cutoverPerformed: true,
      credentialsMigrated: false,
      ...(cutover.syncedSaveFailed ? { syncedSaveFailed: true } : {}),
    };
  }

  const secretStorage = requireSecretStorage(ctx.app);
  const legacySnapshot = snapshotLegacyProviderMembership(raw);
  const credentialMigration = migrateMembershipAwareProviderSecrets(
    secretStorage,
    legacySnapshot,
  );
  const customProvidersWithoutHeaders = migrateCustomProviderHeadersToSecretStorage(
    secretStorage,
    credentialMigration.membership.customProviders,
  );
  await migrateMcpAuthEntriesIfPossible(ctx);

  const localState = normalizeDeviceLocalProviderState(
    buildDeviceLocalStateInputFromLegacy(
      credentialMigration.membership,
      raw,
      customProvidersWithoutHeaders,
    ),
  );
  const settings = buildRuntimeSettingsFromLocalState(raw, localState);
  const cutover = await commitCutover(ctx, localState, settings);

  return {
    settings,
    cutoverPerformed: true,
    credentialsMigrated: credentialMigration.changed,
    ...(cutover.syncedSaveFailed ? { syncedSaveFailed: true } : {}),
  };
}
