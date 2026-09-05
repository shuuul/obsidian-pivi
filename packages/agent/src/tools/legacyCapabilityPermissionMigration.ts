import {
  decodeBashGrant,
  isPosixCompatibleShell,
  isWindowsCmdShell,
} from './bashAuthorization';
import { classifyBashCommand, isHighRiskBashPermission } from './bashCommandClassifier';
import {
  type BashClassificationOptions,
  canonicalizeBashPermissions,
  canonicalizeCapabilityPermissions,
  canonicalizeExternalDirectories,
  createBareNameResolver,
  defaultCaseInsensitiveExecutables,
  type DeviceLocalCapabilityPermissionsV1,
  isPathExecutableToken,
  type PersistentBashPermission,
  type PersistentExternalDirectoryPermission,
} from './capabilityPermissions';

export interface LegacyCapabilityPermissionInput {
  bashAllowlist?: readonly string[];
  externalReadDirectories?: readonly string[];
  shellPath?: string;
  resolveExternalRealpath?: (path: string) => string | null;
  resolveExecutable?: BashClassificationOptions['resolver'];
  caseInsensitive?: boolean;
}

export interface LegacyCapabilityPermissionMigration {
  permissions: DeviceLocalCapabilityPermissionsV1;
  migratedBashCount: number;
  migratedExternalCount: number;
}

/**
 * One-shot conversion of encoded bashAllowlist / external directory strings
 * into structured device-local permission records.
 */
export function migrateLegacyCapabilityPermissions(
  input: LegacyCapabilityPermissionInput,
): LegacyCapabilityPermissionMigration {
  const shellPath = input.shellPath ?? '/bin/sh';
  const caseInsensitive = input.caseInsensitive ?? defaultCaseInsensitiveExecutables(shellPath);
  const resolver = input.resolveExecutable ?? createBareNameResolver(caseInsensitive);
  const bash: PersistentBashPermission[] = [];

  for (const entry of input.bashAllowlist ?? []) {
    bash.push(...migrateBashEntry(entry, shellPath, { resolver, caseInsensitive }));
  }

  const externalDirectories: PersistentExternalDirectoryPermission[] = [];
  for (const directory of input.externalReadDirectories ?? []) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    const realpath = input.resolveExternalRealpath?.(trimmed) ?? trimmed;
    if (!realpath) continue;
    externalDirectories.push({ realpath, enabled: true });
  }

  return {
    permissions: canonicalizeCapabilityPermissions({
      version: 1,
      bash: canonicalizeBashPermissions(bash, caseInsensitive),
      externalDirectories: canonicalizeExternalDirectories(externalDirectories),
    }, caseInsensitive),
    migratedBashCount: (input.bashAllowlist ?? []).length,
    migratedExternalCount: (input.externalReadDirectories ?? []).length,
  };
}

function migrateBashEntry(
  entry: string,
  shellPath: string,
  options: Required<Pick<BashClassificationOptions, 'resolver' | 'caseInsensitive'>>,
): PersistentBashPermission[] {
  if (!isPosixCompatibleShell(shellPath) && !isWindowsCmdShell(shellPath)) {
    return [];
  }
  const grant = decodeBashGrant(entry, shellPath);
  if (!grant) return [];

  if (grant.kind === 'argv-prefix') {
    const permission = prefixGrantToPermission(grant.argv, options);
    return permission ? [{ ...permission, enabled: true }] : [];
  }

  const classification = classifyBashCommand(grant.command, {
    shellPath,
    resolver: options.resolver,
    caseInsensitive: options.caseInsensitive,
  });
  if (!classification.persistable) return [];
  return classification.components.map((component) => ({
    ...component.recommended,
    enabled: !isHighRiskBashPermission(component.recommended),
  }));
}

function prefixGrantToPermission(
  argv: readonly string[],
  options: Required<Pick<BashClassificationOptions, 'resolver' | 'caseInsensitive'>>,
): PersistentBashPermission | null {
  if (argv.length === 0) return null;
  const resolved = options.resolver.resolve(argv[0]!);
  if (resolved === 'unresolved') return null;
  if (argv.length === 1 || isPathExecutableToken(argv[1] ?? '')) {
    return { kind: 'executable', executable: resolved, enabled: true };
  }
  const classification = classifyBashCommand(argv.join(' '), {
    resolver: options.resolver,
    caseInsensitive: options.caseInsensitive,
  });
  if (classification.persistable && classification.components[0]) {
    return { ...classification.components[0].recommended, enabled: true };
  }
  return { kind: 'executable', executable: resolved, enabled: true };
}
