import type {
  BashAllowlistPersistScope,
  CapabilityApprovalPort,
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '../ports/capabilityApproval';
import {
  type BashAuthorizationGrant,
  createExactBashGrant,
  createPrefixBashGrant,
  decodeBashGrant,
  encodeBashGrant,
  matchBashAuthorization,
} from '../tools/bashAuthorization';

export function resolveBashAllowlistPersistEntry(
  command: string,
  scope: BashAllowlistPersistScope,
  shellPath = '/bin/sh',
): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (scope === 'full') return encodeBashGrant(createExactBashGrant(trimmed));
  const grant = createPrefixBashGrant(trimmed, shellPath);
  return grant && grant.kind === 'argv-prefix'
    ? encodeBashGrant({ ...grant, argv: grant.argv.slice(0, 1) })
    : encodeBashGrant(createExactBashGrant(trimmed));
}

export function bashAllowlistPersistScopesDiffer(command: string, shellPath = '/bin/sh'): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  const grant = createPrefixBashGrant(trimmed, shellPath);
  return grant?.kind === 'argv-prefix' && grant.argv.length > 1;
}

function nonBashGrantKey(request: CapabilityApprovalRequest): string | null {
  if (request.kind === 'bash') return null;
  const root = request.directoryRoot?.trim();
  return root ? `external:${root}` : null;
}

function exactBashGrant(request: CapabilityApprovalRequest): BashAuthorizationGrant | null {
  if (request.kind !== 'bash' || !request.command?.trim()) return null;
  return createExactBashGrant(request.command);
}

/**
 * In-memory session grants for bash commands and external directory roots.
 * Cleared when the owning chat session changes or the tab disposes.
 */
export class CapabilitySessionGrants {
  private readonly grantedKeys = new Set<string>();
  private readonly bashAllowEntries: BashAuthorizationGrant[] = [];

  hasSessionGrant(request: CapabilityApprovalRequest): boolean {
    const key = nonBashGrantKey(request);
    if (key != null && this.grantedKeys.has(key)) {
      return true;
    }
    if (request.kind === 'bash' && request.command) {
      return matchBashAuthorization(request.command, request.shellPath ?? '/bin/sh', this.bashAllowEntries);
    }
    return false;
  }

  rememberSessionGrant(request: CapabilityApprovalRequest): void {
    const bashGrant = exactBashGrant(request);
    if (bashGrant) {
      this.rememberBashAllowEntry(bashGrant);
      return;
    }
    const key = nonBashGrantKey(request);
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
  rememberBashAllowEntry(grant: BashAuthorizationGrant | string): void {
    if (typeof grant === 'string') {
      const parsed = decodeBashGrant(grant, '/bin/sh');
      if (!parsed) return;
      grant = parsed;
    }
    if (!this.bashAllowEntries.some(existing => JSON.stringify(existing) === JSON.stringify(grant))) {
      this.bashAllowEntries.push(grant);
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
          const scope = bashAllowlistScope ?? 'full';
          const shellPath = request.shellPath ?? '/bin/sh';
          const grant = scope === 'prefix'
            ? (() => {
              const parsed = createPrefixBashGrant(request.command, shellPath);
              return parsed?.kind === 'argv-prefix'
                ? { ...parsed, argv: parsed.argv.slice(0, 1) } satisfies BashAuthorizationGrant
                : createExactBashGrant(request.command);
            })()
            : createExactBashGrant(request.command);
          const entry = encodeBashGrant(grant);
          if (persistence?.persistBashAllowlistEntry) {
            await persistence.persistBashAllowlistEntry(entry);
          }
          grants.rememberBashAllowEntry(grant);
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
