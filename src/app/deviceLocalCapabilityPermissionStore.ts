import {
  canonicalizeCapabilityPermissions,
  capabilityPermissionsSourceVersion,
  decodeCapabilityPermissions,
  defaultCaseInsensitiveExecutables,
  type DeviceLocalCapabilityPermissions,
} from '@pivi/agent/tools';
import type { App } from 'obsidian';

const DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY = 'pivi.capability-permissions.v1';

export class ObsidianDeviceLocalCapabilityPermissionStore {
  constructor(private readonly app: App) {}

  hasRecord(): boolean {
    return this.app.loadLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY) != null;
  }

  needsLegacyCommandGrantMigration(): boolean {
    return capabilityPermissionsSourceVersion(
      this.app.loadLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY),
    ) === 1;
  }

  getSnapshot(): DeviceLocalCapabilityPermissions {
    return decodeCapabilityPermissions(
      this.app.loadLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY),
    );
  }

  save(next: DeviceLocalCapabilityPermissions): DeviceLocalCapabilityPermissions {
    const normalized = canonicalizeCapabilityPermissions(
      next,
      defaultCaseInsensitiveExecutables(),
    );
    this.app.saveLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY, normalized);
    return normalized;
  }

}
