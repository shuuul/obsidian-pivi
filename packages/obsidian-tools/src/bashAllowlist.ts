import {
  canonicalizeBashPermissions,
  defaultCaseInsensitiveExecutables,
  defaultSafeBashPermissions,
  isWindowsCmdShell,
  matchBashPermissions,
  type PersistentBashPermission,
} from '@pivi/agent/tools';

export const DEFAULT_SAFE_BASH_ALLOWLIST = ['which', 'type', 'pwd'] as const;
export const DEFAULT_WINDOWS_SAFE_BASH_ALLOWLIST = ['where', 'cd'] as const;

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

export function defaultSafeBashAllowlistNames(shellPath: string): readonly string[] {
  return isWindowsCmdShell(shellPath)
    ? DEFAULT_WINDOWS_SAFE_BASH_ALLOWLIST
    : DEFAULT_SAFE_BASH_ALLOWLIST;
}
