import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { FileStore } from '@pivi/agent/ports';
import type { DeviceLocalProviderStore ,
  normalizeDeviceLocalProviderState} from '@pivi/agent/settings/deviceLocalProviderState';
import {
  DeviceLocalProviderStateVersionError,
  overlayDeviceLocalProviderState,
  seedDefaultDeviceLocalProviderState,
  stripLocalizedFieldsFromRuntimeSettings,
} from '@pivi/agent/settings/deviceLocalProviderState';
import type { PiviSettings } from '@pivi/agent/settings/types';
import type { App } from 'obsidian';

import { hasLegacyProviderFields } from '@/app/settings/legacyProviderSnapshot';
import { normalizeStoredPiviSettings } from '@/app/settings/piviSettingsCodec';

const logger = new PluginLogger('DeviceLocalProviderMigration');

class DeviceLocalProviderMigrationError extends Error {
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
  syncedSaveFailed?: boolean;
}

function buildPortableRuntimeSettings(raw: Record<string, unknown>): PiviSettings {
  return normalizeStoredPiviSettings(raw);
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
    let syncedSaveFailed = false;
    // An older device can sync provider fields back into the vault; drop them.
    if (hasLegacyProviderFields(raw)) {
      syncedSaveFailed = await stripSyncedLocalizedFields(ctx, settings);
    }
    return {
      settings,
      cutoverPerformed: false,
      ...(syncedSaveFailed ? { syncedSaveFailed: true } : {}),
    };
  }

  // First run on this device. Provider fields left in synced settings by a
  // release older than 0.15.0 are not migrated; they are stripped on save.
  const localState = seedDefaultDeviceLocalProviderState();
  const settings = buildRuntimeSettingsFromLocalState(raw, localState);
  const cutover = await commitCutover(ctx, localState, settings);
  return {
    settings,
    cutoverPerformed: true,
    ...(cutover.syncedSaveFailed ? { syncedSaveFailed: true } : {}),
  };
}
