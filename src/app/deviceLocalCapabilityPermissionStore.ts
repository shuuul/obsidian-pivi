import {
  canonicalizeCapabilityPermissions,
  decodeCapabilityPermissions,
  defaultCaseInsensitiveExecutables,
  type DeviceLocalCapabilityPermissionsV1,
  emptyCapabilityPermissions,
  enabledBashPermissions,
  enabledExternalDirectories,
  type PersistentBashPermission,
  type PersistentExternalDirectoryPermission,
} from '@pivi/agent/tools';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY = 'pivi.capability-permissions.v1';

export class ObsidianDeviceLocalCapabilityPermissionStore {
  private revision = 0;

  constructor(private readonly app: App) {}

  hasRecord(): boolean {
    return this.app.loadLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY) != null;
  }

  getSnapshot(): DeviceLocalCapabilityPermissionsV1 {
    return decodeCapabilityPermissions(
      this.app.loadLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY),
    );
  }

  getRevision(): number {
    return this.revision;
  }

  getEnabledBashPermissions(): PersistentBashPermission[] {
    return enabledBashPermissions(this.getSnapshot().bash);
  }

  getEnabledExternalDirectories(): string[] {
    return enabledExternalDirectories(this.getSnapshot().externalDirectories);
  }

  save(next: DeviceLocalCapabilityPermissionsV1): DeviceLocalCapabilityPermissionsV1 {
    const normalized = canonicalizeCapabilityPermissions(
      next,
      defaultCaseInsensitiveExecutables(),
    );
    this.app.saveLocalStorage(DEVICE_LOCAL_CAPABILITY_PERMISSIONS_STORAGE_KEY, normalized);
    this.revision += 1;
    return normalized;
  }

  replaceBash(bash: readonly PersistentBashPermission[]): DeviceLocalCapabilityPermissionsV1 {
    return this.save({ ...this.getSnapshot(), bash: [...bash] });
  }

  upsertBash(permission: PersistentBashPermission): DeviceLocalCapabilityPermissionsV1 {
    const snapshot = this.getSnapshot();
    return this.save({ ...snapshot, bash: [...snapshot.bash, permission] });
  }

  upsertExternalDirectory(directory: PersistentExternalDirectoryPermission): DeviceLocalCapabilityPermissionsV1 {
    const snapshot = this.getSnapshot();
    return this.save({
      ...snapshot,
      externalDirectories: [...snapshot.externalDirectories, directory],
    });
  }

  initializeEmpty(): DeviceLocalCapabilityPermissionsV1 {
    if (this.hasRecord()) return this.getSnapshot();
    return this.save(emptyCapabilityPermissions());
  }
}
