/**
 * Host-neutral persistent Bash, Obsidian-command, and external-directory permission records.
 * Rule identity is the normalized content; there is no independent mutable ID.
 */

import { isPosixCompatibleShell, isWindowsCmdShell } from './bashAuthorization';

export const BASH_CLASSIFIER_VERSION = 1;
export const LEGACY_DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION = 1 as const;
export const DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION = 2 as const;

export type ExecutableIdentity =
  | { kind: 'name'; value: string }
  | { kind: 'realpath'; value: string };

export type PersistentBashPermission =
  | { kind: 'executable'; executable: ExecutableIdentity; enabled: boolean }
  | {
      kind: 'subcommand';
      executable: ExecutableIdentity;
      subcommand: string;
      enabled: boolean;
    };

export interface PersistentExternalDirectoryPermission {
  realpath: string;
  enabled: boolean;
}

export interface DeviceLocalCapabilityPermissionsV1 {
  version: typeof LEGACY_DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION;
  bash: PersistentBashPermission[];
  externalDirectories: PersistentExternalDirectoryPermission[];
  obsidianCommands?: string[];
}

export interface DeviceLocalCapabilityPermissionsV2 {
  version: typeof DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION;
  bash: PersistentBashPermission[];
  externalDirectories: PersistentExternalDirectoryPermission[];
  obsidianCommands: string[];
}

export type DeviceLocalCapabilityPermissions = DeviceLocalCapabilityPermissionsV2;

type CapabilityPermissionsRecord = {
  version: typeof LEGACY_DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION
    | typeof DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION;
  bash: PersistentBashPermission[];
  externalDirectories: PersistentExternalDirectoryPermission[];
  obsidianCommands?: string[];
};

export type BashScopeRisk = 'none' | 'high' | 'executor';

export interface ClassifiedBashComponent {
  recommended: PersistentBashPermission;
  broader?: PersistentBashPermission;
  risk: BashScopeRisk;
  displayLabel: string;
}

export type BashClassification =
  | { persistable: false; reason: 'unsafe-syntax' | 'unresolved-relative' | 'empty' | 'legacy-encoding' }
  | { persistable: true; components: ClassifiedBashComponent[] };

export interface BashExecutableResolver {
  resolve(executable: string): ExecutableIdentity | 'unresolved';
}

export interface BashClassificationOptions {
  shellPath?: string;
  resolver?: BashExecutableResolver;
  caseInsensitive?: boolean;
}

export function emptyCapabilityPermissions(): DeviceLocalCapabilityPermissions {
  return {
    version: DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
    bash: [],
    externalDirectories: [],
    obsidianCommands: [],
  };
}

export function isAbsoluteExecutablePath(token: string): boolean {
  return token.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(token)
    || token.startsWith('\\\\');
}

export function isPathExecutableToken(token: string): boolean {
  return isAbsoluteExecutablePath(token)
    || token.startsWith('.')
    || token.includes('/')
    || token.includes('\\');
}

export function executableBasename(token: string): string {
  const normalized = token.replaceAll('\\', '/');
  const base = normalized.split('/').pop() ?? token;
  return base;
}

export function defaultCaseInsensitiveExecutables(shellPath = '/bin/sh'): boolean {
  if (isWindowsCmdShell(shellPath)) return true;
  return typeof process !== 'undefined' && (process.platform === 'win32' || process.platform === 'darwin');
}

export function normalizeExecutableName(token: string, caseInsensitive: boolean): string {
  let value = executableBasename(token);
  if (caseInsensitive && /\.(exe|cmd|bat)$/i.test(value)) {
    value = value.replace(/\.(exe|cmd|bat)$/i, '');
  }
  return caseInsensitive ? value.toLowerCase() : value;
}

export function normalizeSubcommand(token: string, caseInsensitive: boolean): string {
  return caseInsensitive ? token.toLowerCase() : token;
}

export function identitiesEqual(
  left: ExecutableIdentity,
  right: ExecutableIdentity,
  caseInsensitive: boolean,
): boolean {
  if (left.kind !== right.kind) return false;
  if (caseInsensitive) {
    return left.value.toLowerCase() === right.value.toLowerCase();
  }
  return left.value === right.value;
}

export function bashPermissionIdentityKey(
  permission: PersistentBashPermission,
  caseInsensitive = false,
): string {
  const exe = permission.executable.kind === 'name'
    ? `name:${caseInsensitive ? permission.executable.value.toLowerCase() : permission.executable.value}`
    : `realpath:${caseInsensitive ? permission.executable.value.toLowerCase() : permission.executable.value}`;
  if (permission.kind === 'executable') return `executable|${exe}`;
  const sub = caseInsensitive ? permission.subcommand.toLowerCase() : permission.subcommand;
  return `subcommand|${exe}|${sub}`;
}

export function formatBashPermissionLabel(permission: PersistentBashPermission): string {
  const exe = permission.executable.value;
  return permission.kind === 'executable' ? exe : `${exe} ${permission.subcommand}`;
}

export function createBareNameResolver(caseInsensitive: boolean): BashExecutableResolver {
  return {
    resolve(executable) {
      const trimmed = executable.trim();
      if (!trimmed) return 'unresolved';
      if (isPathExecutableToken(trimmed)) {
        if (isAbsoluteExecutablePath(trimmed)) {
          return { kind: 'realpath', value: trimmed };
        }
        return 'unresolved';
      }
      return { kind: 'name', value: normalizeExecutableName(trimmed, caseInsensitive) };
    },
  };
}

export function defaultSafeBashPermissions(shellPath = '/bin/sh'): PersistentBashPermission[] {
  const names = isWindowsCmdShell(shellPath)
    ? ['where', 'cd']
    : ['which', 'type', 'pwd'];
  const caseInsensitive = defaultCaseInsensitiveExecutables(shellPath);
  return names.map((value) => ({
    kind: 'executable' as const,
    executable: { kind: 'name' as const, value: normalizeExecutableName(value, caseInsensitive) },
    enabled: true,
  }));
}

function permissionCovers(
  grant: PersistentBashPermission,
  need: PersistentBashPermission,
  caseInsensitive: boolean,
): boolean {
  if (!grant.enabled) return false;
  if (!identitiesEqual(grant.executable, need.executable, caseInsensitive)) return false;
  if (grant.kind === 'executable') return true;
  return need.kind === 'subcommand'
    && normalizeSubcommand(grant.subcommand, caseInsensitive)
      === normalizeSubcommand(need.subcommand, caseInsensitive);
}

export function canonicalizeBashPermissions(
  permissions: readonly PersistentBashPermission[],
  caseInsensitive = false,
): PersistentBashPermission[] {
  const byKey = new Map<string, PersistentBashPermission>();
  for (const permission of permissions) {
    const normalized = normalizeBashPermission(permission, caseInsensitive);
    if (!normalized) continue;
    const key = bashPermissionIdentityKey(normalized, caseInsensitive);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }
    if (normalized.enabled && !existing.enabled) {
      byKey.set(key, { ...existing, enabled: true });
    }
  }

  const deduped = [...byKey.values()];
  return deduped.filter((permission, index) => {
    if (permission.kind !== 'subcommand') return true;
    return !deduped.some((other, otherIndex) => (
      otherIndex !== index
      && other.kind === 'executable'
      && other.enabled
      && identitiesEqual(other.executable, permission.executable, caseInsensitive)
    ));
  });
}

export function normalizeBashPermission(
  permission: PersistentBashPermission,
  caseInsensitive: boolean,
): PersistentBashPermission | null {
  const executable = normalizeExecutableIdentity(permission.executable, caseInsensitive);
  if (!executable) return null;
  if (permission.kind === 'executable') {
    return { kind: 'executable', executable, enabled: permission.enabled };
  }
  const subcommand = normalizeSubcommand(permission.subcommand.trim(), caseInsensitive);
  if (!subcommand) return null;
  return { kind: 'subcommand', executable, subcommand, enabled: permission.enabled };
}

function normalizeExecutableIdentity(
  identity: ExecutableIdentity,
  caseInsensitive: boolean,
): ExecutableIdentity | null {
  const value = identity.value.trim();
  if (!value) return null;
  if (identity.kind === 'name') {
    return { kind: 'name', value: normalizeExecutableName(value, caseInsensitive) };
  }
  return { kind: 'realpath', value: caseInsensitive ? value : value };
}

export function canonicalizeExternalDirectories(
  directories: readonly PersistentExternalDirectoryPermission[],
): PersistentExternalDirectoryPermission[] {
  const byPath = new Map<string, PersistentExternalDirectoryPermission>();
  for (const directory of directories) {
    const realpath = directory.realpath.trim();
    if (!realpath) continue;
    const existing = byPath.get(realpath);
    if (!existing) {
      byPath.set(realpath, { realpath, enabled: directory.enabled });
      continue;
    }
    if (directory.enabled && !existing.enabled) {
      byPath.set(realpath, { realpath, enabled: true });
    }
  }
  return [...byPath.values()];
}

export function canonicalizeCapabilityPermissions(
  stored: CapabilityPermissionsRecord,
  caseInsensitive = false,
): DeviceLocalCapabilityPermissions {
  return {
    version: DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
    bash: canonicalizeBashPermissions(stored.bash, caseInsensitive),
    externalDirectories: canonicalizeExternalDirectories(stored.externalDirectories),
    obsidianCommands: [...new Set((stored.obsidianCommands ?? []).map(id => id.trim()).filter(Boolean))],
  };
}

export function enabledBashPermissions(
  stored: readonly PersistentBashPermission[],
): PersistentBashPermission[] {
  return stored.filter(permission => permission.enabled);
}

export function enabledExternalDirectories(
  stored: readonly PersistentExternalDirectoryPermission[],
): string[] {
  return stored.filter(directory => directory.enabled).map(directory => directory.realpath);
}

export function matchPersistentBashPermissions(
  command: string,
  permissions: readonly PersistentBashPermission[],
  options: BashClassificationOptions & {
    classify: (command: string, options?: BashClassificationOptions) => BashClassification;
  },
): boolean {
  if (!isPosixCompatibleShell(options.shellPath ?? '/bin/sh')
    && !isWindowsCmdShell(options.shellPath ?? '/bin/sh')) {
    return false;
  }
  const classification = options.classify(command, options);
  if (!classification.persistable) return false;
  const caseInsensitive = options.caseInsensitive ?? defaultCaseInsensitiveExecutables(options.shellPath);
  return classification.components.every(component => (
    permissions.some(permission => permissionCovers(permission, component.recommended, caseInsensitive))
  ));
}

export function capabilityPermissionsSourceVersion(raw: unknown): 1 | 2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const version = (raw as Record<string, unknown>).version;
  return version === LEGACY_DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION
    || version === DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION
    ? version
    : null;
}

export function decodeCapabilityPermissions(raw: unknown): DeviceLocalCapabilityPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyCapabilityPermissions();
  }
  const record = raw as Record<string, unknown>;
  const sourceVersion = capabilityPermissionsSourceVersion(record);
  if (sourceVersion === null) {
    return emptyCapabilityPermissions();
  }
  return canonicalizeCapabilityPermissions({
    version: sourceVersion,
    bash: decodeBashPermissionList(record.bash),
    externalDirectories: decodeExternalDirectoryList(record.externalDirectories),
    obsidianCommands: decodeStringList(record.obsidianCommands),
  });
}

function decodeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function decodeBashPermissionList(value: unknown): PersistentBashPermission[] {
  if (!Array.isArray(value)) return [];
  const permissions: PersistentBashPermission[] = [];
  for (const entry of value) {
    const decoded = decodeBashPermission(entry);
    if (decoded) permissions.push(decoded);
  }
  return permissions;
}

function decodeBashPermission(value: unknown): PersistentBashPermission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const executable = decodeExecutableIdentity(record.executable);
  if (!executable) return null;
  const enabled = record.enabled !== false;
  if (record.kind === 'executable') {
    return { kind: 'executable', executable, enabled };
  }
  if (record.kind === 'subcommand' && typeof record.subcommand === 'string') {
    const subcommand = record.subcommand.trim();
    if (!subcommand) return null;
    return { kind: 'subcommand', executable, subcommand, enabled };
  }
  return null;
}

function decodeExecutableIdentity(value: unknown): ExecutableIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.value !== 'string' || !record.value.trim()) return null;
  if (record.kind === 'name' || record.kind === 'realpath') {
    return { kind: record.kind, value: record.value.trim() };
  }
  return null;
}

function decodeExternalDirectoryList(value: unknown): PersistentExternalDirectoryPermission[] {
  if (!Array.isArray(value)) return [];
  const directories: PersistentExternalDirectoryPermission[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.realpath !== 'string' || !record.realpath.trim()) continue;
    directories.push({ realpath: record.realpath.trim(), enabled: record.enabled !== false });
  }
  return directories;
}
