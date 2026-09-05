import type {
  CapabilityApprovalPort,
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '../ports/capabilityApproval';
import { matchBashPermissions } from '../tools/bashCommandClassifier';
import {
  defaultSafeBashPermissions,
  type PersistentBashPermission,
} from '../tools/capabilityPermissions';

export interface CapabilityApprovalPresenter {
  (request: CapabilityApprovalRequest): Promise<CapabilityApprovalResult>;
}

export interface CapabilityApprovalPersistence {
  persistBashPermissions?(permissions: readonly PersistentBashPermission[]): Promise<void>;
  persistExternalDirectory?(directory: string): Promise<void>;
  onExternalDirectoryAllowed?(directory: string): Promise<void>;
  getBashPermissions?(): readonly PersistentBashPermission[];
  getExternalDirectories?(): readonly string[];
}

/**
 * In-memory acceleration of committed persistent rules so a stale tool snapshot
 * still sees an Always grant immediately. This is not a session-duration authority.
 */
export class CapabilityPersistentGrantCache {
  private bash: PersistentBashPermission[] = [];
  private externalRoots = new Set<string>();

  replace(bash: readonly PersistentBashPermission[], externalRoots: readonly string[]): void {
    this.bash = [...bash];
    this.externalRoots = new Set(externalRoots.filter(Boolean));
  }

  rememberBash(permissions: readonly PersistentBashPermission[]): void {
    this.bash = [...this.bash, ...permissions];
  }

  rememberExternal(root: string): void {
    const trimmed = root.trim();
    if (trimmed) this.externalRoots.add(trimmed);
  }

  hasPersistentGrant(request: CapabilityApprovalRequest): boolean {
    if (request.kind === 'external-directory') {
      const root = request.directoryRoot?.trim();
      return !!root && this.externalRoots.has(root);
    }
    if (request.kind === 'bash' && request.command) {
      const shellPath = request.shellPath ?? '/bin/sh';
      return matchBashPermissions(
        request.command,
        [...defaultSafeBashPermissions(shellPath), ...this.bash],
        { shellPath },
      );
    }
    return false;
  }

  clear(): void {
    this.bash = [];
    this.externalRoots.clear();
  }
}

export function createCapabilityApprovalPort(options: {
  cache: CapabilityPersistentGrantCache;
  present: CapabilityApprovalPresenter;
  persistence?: CapabilityApprovalPersistence;
}): CapabilityApprovalPort {
  const { cache, present, persistence } = options;
  return {
    hasPersistentGrant: (request) => {
      if (request.kind === 'bash' && request.command && persistence?.getBashPermissions) {
        const shellPath = request.shellPath ?? '/bin/sh';
        return matchBashPermissions(
          request.command,
          [...defaultSafeBashPermissions(shellPath), ...persistence.getBashPermissions()],
          { shellPath },
        );
      }
      if (request.kind === 'external-directory' && persistence?.getExternalDirectories) {
        const root = request.directoryRoot?.trim();
        return !!root && persistence.getExternalDirectories().includes(root);
      }
      return cache.hasPersistentGrant(request);
    },
    async requestApproval(request) {
      const result = await present(request);
      if (result.decision !== 'allow-always') {
        return result;
      }
      if (request.kind === 'bash') {
        const permissions = result.bashPermissions ?? [];
        if (permissions.length === 0) {
          return { decision: 'cancel' };
        }
        if (persistence?.persistBashPermissions) {
          await persistence.persistBashPermissions(permissions);
        }
        cache.rememberBash(permissions);
        return result;
      }
      if (request.kind === 'external-directory' && request.directoryRoot) {
        if (persistence?.persistExternalDirectory) {
          await persistence.persistExternalDirectory(request.directoryRoot);
        }
        await persistence?.onExternalDirectoryAllowed?.(request.directoryRoot);
        cache.rememberExternal(request.directoryRoot);
      }
      return result;
    },
  };
}
