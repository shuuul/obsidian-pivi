import type {
  DeviceLocalEnvironmentStateV1,
  DeviceLocalEnvironmentStore,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import {
  assertSupportedDeviceLocalEnvironmentStateVersion,
  normalizeDeviceLocalEnvironmentState,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_ENVIRONMENT_STORAGE_KEY = 'pivi.environment.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStored(app: App): Record<string, unknown> | null {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_ENVIRONMENT_STORAGE_KEY);
  if (!raw || !isRecord(raw)) {
    return null;
  }
  return raw;
}

export class ObsidianDeviceLocalEnvironmentStore implements DeviceLocalEnvironmentStore {
  constructor(private readonly app: App) {}

  loadInitialized(): DeviceLocalEnvironmentStateV1 | null {
    const stored = readStored(this.app);
    if (!stored) {
      return null;
    }
    assertSupportedDeviceLocalEnvironmentStateVersion(stored.version);
    if (stored.initialized !== true) {
      return null;
    }
    return normalizeDeviceLocalEnvironmentState(stored);
  }

  isInitialized(): boolean {
    return this.loadInitialized() !== null;
  }

  save(state: DeviceLocalEnvironmentStateV1): void {
    const normalized = normalizeDeviceLocalEnvironmentState({
      ...state,
      version: 1,
      initialized: true,
    });
    this.app.saveLocalStorage(DEVICE_LOCAL_ENVIRONMENT_STORAGE_KEY, normalized);
  }
}
