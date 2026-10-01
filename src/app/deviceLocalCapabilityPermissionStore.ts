import {
  canonicalizeCapabilityPermissions,
  capabilityPermissionsSourceVersion,
  decodeCapabilityPermissions,
  defaultCaseInsensitiveExecutables,
  type DeviceLocalCapabilityPermissions,
} from '@pivi/agent/tools';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY = 'pivi.capability-permissions.v1';

export class ObsidianDeviceLocalCapabilityPermissionStore {
  private revision = 0;

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

  getRevision(): number {
    return this.revision;
  }

  save(next: DeviceLocalCapabilityPermissions): DeviceLocalCapabilityPermissions {
    const normalized = canonicalizeCapabilityPermissions(
      next,
      defaultCaseInsensitiveExecutables(),
    );
    this.app.saveLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY, normalized);
    this.revision += 1;
    return normalized;
  }

}
