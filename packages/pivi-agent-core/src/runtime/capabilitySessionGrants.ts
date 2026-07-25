import type {
  BashAllowlistPersistScope,
  CapabilityApprovalPort,
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '../ports/capabilityApproval';
import { tokenizeBashArgv } from '../tools/bashArgv';

export function resolveBashAllowlistPersistEntry(
  command: string,
  scope: BashAllowlistPersistScope,
): string {
  const trimmed = command.trim();
  if (!trimmed || scope === 'full') {
    return trimmed;
  }
  const tokens = tokenizeBashArgv(trimmed);
  return tokens[0] ?? trimmed;
}

export function bashAllowlistPersistScopesDiffer(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  return resolveBashAllowlistPersistEntry(trimmed, 'prefix')
    !== resolveBashAllowlistPersistEntry(trimmed, 'full');
}

function grantKey(request: CapabilityApprovalRequest): string | null {
  if (request.kind === 'bash') {
    const command = request.command?.trim();
    return command ? `bash:${command}` : null;
  }
  const root = request.directoryRoot?.trim();
  return root ? `external:${root}` : null;
}

function tokenizeOrNull(command: string): string[] | null {
  try {
    const tokens = tokenizeBashArgv(command);
    return tokens.length > 0 ? tokens : null;
  } catch {
    return null;
  }
}

function isTokenPrefix(prefix: readonly string[], tokens: readonly string[]): boolean {
  return prefix.length <= tokens.length && prefix.every((token, index) => token === tokens[index]);
}

/**
 * In-memory session grants for bash commands and external directory roots.
 * Cleared when the owning chat session changes or the tab disposes.
 */
export class CapabilitySessionGrants {
  private readonly grantedKeys = new Set<string>();
  private readonly bashAllowEntries: string[][] = [];

  hasSessionGrant(request: CapabilityApprovalRequest): boolean {
    const key = grantKey(request);
    if (key != null && this.grantedKeys.has(key)) {
      return true;
    }
    if (request.kind === 'bash' && request.command) {
      const tokens = tokenizeOrNull(request.command.trim());
      if (tokens) {
        return this.bashAllowEntries.some((entry) => isTokenPrefix(entry, tokens));
      }
    }
    return false;
  }

  rememberSessionGrant(request: CapabilityApprovalRequest): void {
    const key = grantKey(request);
    if (key) {
      this.grantedKeys.add(key);
    }
  }

  /**
   * Remember an always-allowed bash entry with the same token-prefix semantics
   * as the persisted settings allowlist. The running agent (and in-flight or
   * idle-reused subagents) can hold a stale settings snapshot, so the freshly
   * persisted allowlist entry is invisible until the next registry rebuild;
   * the shared session grant makes the approval effective immediately.
   */
  rememberBashAllowEntry(entry: string): void {
    const tokens = tokenizeOrNull(entry.trim());
    if (!tokens) {
      return;
    }
    if (!this.bashAllowEntries.some((existing) => isTokenPrefix(existing, tokens) && isTokenPrefix(tokens, existing))) {
      this.bashAllowEntries.push(tokens);
    }
  }

  clear(): void {
    this.grantedKeys.clear();
    this.bashAllowEntries.length = 0;
  }
}

export interface CapabilityApprovalPresenter {
  (request: CapabilityApprovalRequest): Promise<CapabilityApprovalResult>;
}

export interface CapabilityApprovalPersistence {
  persistBashAllowlistEntry?(command: string): Promise<void>;
  persistExternalDirectory?(directory: string): Promise<void>;
  onExternalDirectoryAllowed?(directory: string): Promise<void>;
}

export function createCapabilityApprovalPort(options: {
  grants: CapabilitySessionGrants;
  present: CapabilityApprovalPresenter;
  persistence?: CapabilityApprovalPersistence;
}): CapabilityApprovalPort {
  const { grants, present, persistence } = options;
  return {
    hasSessionGrant: (request) => grants.hasSessionGrant(request),
    clearSessionGrants: () => grants.clear(),
    async requestApproval(request) {
      const result = await present(request);
      const { decision, bashAllowlistScope } = result;
      if (decision === 'allow-session') {
        grants.rememberSessionGrant(request);
      } else if (decision === 'allow-always') {
        if (request.kind === 'bash' && request.command) {
          const entry = resolveBashAllowlistPersistEntry(request.command, bashAllowlistScope ?? 'full');
          if (persistence?.persistBashAllowlistEntry) {
            await persistence.persistBashAllowlistEntry(entry);
          }
          grants.rememberBashAllowEntry(entry);
        } else if (
          request.kind === 'external-directory'
          && request.directoryRoot
          && persistence?.persistExternalDirectory
        ) {
          await persistence.persistExternalDirectory(request.directoryRoot);
          await persistence.onExternalDirectoryAllowed?.(request.directoryRoot);
        }
        grants.rememberSessionGrant(request);
      }
      return result;
    },
  };
}
