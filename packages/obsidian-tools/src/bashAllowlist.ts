import {
  canonicalizeBashPermissions,
  defaultCaseInsensitiveExecutables,
  defaultSafeBashPermissions,
  matchBashPermissions,
  type PersistentBashPermission,
} from '@pivi/agent/tools';

export function buildEffectiveBashPermissions(
  userPermissions?: readonly PersistentBashPermission[],
  shellPath = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
): readonly PersistentBashPermission[] {
  return canonicalizeBashPermissions(
    [...defaultSafeBashPermissions(shellPath), ...(userPermissions ?? [])],
    defaultCaseInsensitiveExecutables(shellPath),
  );
}

/**
 * Match one command against structured persistent Bash permissions plus safe defaults.
 */
export function matchBashCommandAllowlist(
  command: string,
  permissions: readonly PersistentBashPermission[],
  shellPath = '/bin/sh',
): boolean {
  return matchBashPermissions(
    command,
    buildEffectiveBashPermissions(permissions, shellPath),
    { shellPath },
  );
}
