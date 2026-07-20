import type {
  DeviceLocalProviderStateV1,
  DeviceLocalProviderStore,
} from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';
import {
  assertSupportedDeviceLocalProviderStateVersion,
  normalizeDeviceLocalProviderState,
} from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_PROVIDER_STORAGE_KEY = 'pivi.providers.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStored(app: App): Record<string, unknown> | null {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY);
  if (!raw || !isRecord(raw)) {
    return null;
  }
  return raw;
}

export class ObsidianDeviceLocalProviderStore implements DeviceLocalProviderStore {
  constructor(private readonly app: App) {}

  loadInitialized(): DeviceLocalProviderStateV1 | null {
    const stored = readStored(this.app);
    if (!stored) {
      return null;
    }
    assertSupportedDeviceLocalProviderStateVersion(stored.version);
    if (stored.initialized !== true) {
      return null;
    }
    return normalizeDeviceLocalProviderState(stored);
  }

  isInitialized(): boolean {
    return this.loadInitialized() !== null;
  }

  save(state: DeviceLocalProviderStateV1): void {
    const normalized = normalizeDeviceLocalProviderState({
      ...state,
      version: 1,
      initialized: true,
    });
    this.app.saveLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY, normalized);
  }
}
