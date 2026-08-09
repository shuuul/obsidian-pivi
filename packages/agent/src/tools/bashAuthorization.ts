import { tokenizeBashArgv } from './bashArgv';

export type BashAuthorizationGrant =
  | { kind: 'exact-shell'; command: string }
  | { kind: 'argv-prefix'; argv: readonly string[] };

export const BASH_EXACT_ENTRY_PREFIX = 'exact: ';
export const BASH_PREFIX_ENTRY_PREFIX = 'prefix: ';

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ksh93']);

export function normalizeBashCommand(command: string): string {
  return command.trim();
}

export function isPosixCompatibleShell(shellPath: string): boolean {
  const base = shellPath.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? '';
  return POSIX_SHELLS.has(base);
}

export function createExactBashGrant(command: string): BashAuthorizationGrant {
  return { kind: 'exact-shell', command: normalizeBashCommand(command) };
}

export function createPrefixBashGrant(command: string, shellPath: string): BashAuthorizationGrant | null {
  if (!isPosixCompatibleShell(shellPath)) return null;
  try {
    const argv = tokenizeBashArgv(normalizeBashCommand(command));
    return argv.length > 0 ? { kind: 'argv-prefix', argv } : null;
  } catch {
    return null;
  }
}

export function encodeBashGrant(grant: BashAuthorizationGrant): string {
  return grant.kind === 'exact-shell'
    ? `${BASH_EXACT_ENTRY_PREFIX}${grant.command}`
    : `${BASH_PREFIX_ENTRY_PREFIX}${JSON.stringify(grant.argv)}`;
}

export function decodeBashGrant(entry: string, shellPath: string): BashAuthorizationGrant | null {
  const normalized = entry.trim();
  if (normalized.startsWith(BASH_EXACT_ENTRY_PREFIX)) {
    const command = normalizeBashCommand(normalized.slice(BASH_EXACT_ENTRY_PREFIX.length));
    return command ? createExactBashGrant(command) : null;
  }
  if (normalized.startsWith(BASH_PREFIX_ENTRY_PREFIX)) {
    if (!isPosixCompatibleShell(shellPath)) return null;
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

export function matchBashAuthorization(
  command: string,
  shellPath: string,
  grants: readonly BashAuthorizationGrant[],
): boolean {
  const normalized = normalizeBashCommand(command);
  if (grants.some(grant => grant.kind === 'exact-shell' && grant.command === normalized)) return true;
  if (!isPosixCompatibleShell(shellPath)) return false;
  const candidate = createPrefixBashGrant(normalized, shellPath);
  if (!candidate || candidate.kind !== 'argv-prefix') return false;
  return grants.some(grant => grant.kind === 'argv-prefix'
    && grant.argv.length <= candidate.argv.length
    && grant.argv.every((token, index) => token === candidate.argv[index]));
}

export function matchEncodedBashAllowlist(command: string, shellPath: string, entries: readonly string[]): boolean {
  return matchBashAuthorization(command, shellPath, entries.map(entry => decodeBashGrant(entry, shellPath)).filter((grant): grant is BashAuthorizationGrant => grant != null));
}
