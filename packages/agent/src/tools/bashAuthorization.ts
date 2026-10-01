import { tokenizeBashArgv, tokenizeCmdArgv } from './bashArgv';

export type BashAuthorizationGrant =
  | { kind: 'exact-shell'; command: string }
  | { kind: 'argv-prefix'; argv: readonly string[] };

export const BASH_EXACT_ENTRY_PREFIX = 'exact: ';
export const BASH_PREFIX_ENTRY_PREFIX = 'prefix: ';

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ksh93']);
const CMD_SHELLS = new Set(['cmd', 'cmd.exe']);

export function normalizeBashCommand(command: string): string {
  return command.trim();
}

export function isPosixCompatibleShell(shellPath: string): boolean {
  const base = shellPath.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? '';
  return POSIX_SHELLS.has(base);
}

export function isWindowsCmdShell(shellPath: string): boolean {
  const base = shellPath.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? '';
  return CMD_SHELLS.has(base);
}

export function createExactBashGrant(command: string): BashAuthorizationGrant {
  return { kind: 'exact-shell', command: normalizeBashCommand(command) };
}

export function createPrefixBashGrant(command: string, shellPath: string): BashAuthorizationGrant | null {
  if (!isPosixCompatibleShell(shellPath) && !isWindowsCmdShell(shellPath)) return null;
  try {
    const argv = isWindowsCmdShell(shellPath)
      ? tokenizeCmdArgv(normalizeBashCommand(command))
      : tokenizeBashArgv(normalizeBashCommand(command));
    return argv.length > 0 ? { kind: 'argv-prefix', argv } : null;
  } catch {
    return null;
  }
}

export function decodeBashGrant(entry: string, shellPath: string): BashAuthorizationGrant | null {
  const normalized = entry.trim();
  if (normalized.startsWith(BASH_EXACT_ENTRY_PREFIX)) {
    const command = normalizeBashCommand(normalized.slice(BASH_EXACT_ENTRY_PREFIX.length));
    return command ? createExactBashGrant(command) : null;
  }
  if (normalized.startsWith(BASH_PREFIX_ENTRY_PREFIX)) {
    if (!isPosixCompatibleShell(shellPath) && !isWindowsCmdShell(shellPath)) return null;
    const encodedArgv = normalized.slice(BASH_PREFIX_ENTRY_PREFIX.length);
    try {
      const argv: unknown = JSON.parse(encodedArgv);
      if (
        Array.isArray(argv)
        && argv.length > 0
        && argv.every((token): token is string => typeof token === 'string')
      ) {
        return { kind: 'argv-prefix', argv };
      }
    } catch {
      // Continue with the legacy token format below.
    }
    // Prefix entries written before the JSON-array format remain readable.
    return createPrefixBashGrant(encodedArgv, shellPath);
  }
  // Legacy untagged entries retain prefix behavior only when the resolved shell
  // is known POSIX-compatible and both entry and candidate pass the safe parser.
  return createPrefixBashGrant(normalized, shellPath);
}
