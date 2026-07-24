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

/**
 * In-memory session grants for bash commands and external directory roots.
 * Cleared when the owning chat session changes or the tab disposes.
 */
export class CapabilitySessionGrants {
  private readonly grantedKeys = new Set<string>();

  hasSessionGrant(request: CapabilityApprovalRequest): boolean {
    const key = grantKey(request);
    return key != null && this.grantedKeys.has(key);
  }

  rememberSessionGrant(request: CapabilityApprovalRequest): void {
    const key = grantKey(request);
    if (key) {
      this.grantedKeys.add(key);
    }
  }

  clear(): void {
    this.grantedKeys.clear();
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
        if (request.kind === 'bash' && request.command && persistence?.persistBashAllowlistEntry) {
          await persistence.persistBashAllowlistEntry(
            resolveBashAllowlistPersistEntry(request.command, bashAllowlistScope ?? 'full'),
          );
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
