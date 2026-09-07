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
  persistObsidianCommand?(commandId: string): Promise<void>;
  onExternalDirectoryAllowed?(directory: string): Promise<void>;
  getBashPermissions?(): readonly PersistentBashPermission[];
  getExternalDirectories?(): readonly string[];
  getObsidianCommands?(): readonly string[];
}

/**
 * In-memory acceleration of committed persistent rules so a stale tool snapshot
 * still sees an Always grant immediately. This is not a session-duration authority.
 */
export class CapabilityPersistentGrantCache {
  private bash: PersistentBashPermission[] = [];
  private externalRoots = new Set<string>();
  private obsidianCommands = new Set<string>();

  replace(
    bash: readonly PersistentBashPermission[],
    externalRoots: readonly string[],
    obsidianCommands: readonly string[] = [],
  ): void {
    this.bash = [...bash];
    this.externalRoots = new Set(externalRoots.filter(Boolean));
    this.obsidianCommands = new Set(obsidianCommands.map(id => id.trim()).filter(Boolean));
  }

  rememberBash(permissions: readonly PersistentBashPermission[]): void {
    this.bash = [...this.bash, ...permissions];
  }

  rememberExternal(root: string): void {
    const trimmed = root.trim();
    if (trimmed) this.externalRoots.add(trimmed);
  }

  rememberObsidianCommand(commandId: string): void {
    const trimmed = commandId.trim();
    if (trimmed) this.obsidianCommands.add(trimmed);
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
    if (request.kind === 'obsidian-command') {
      const commandId = request.commandId?.trim();
      return !!commandId && this.obsidianCommands.has(commandId);
    }
    return false;
  }

  clear(): void {
    this.bash = [];
    this.externalRoots.clear();
    this.obsidianCommands.clear();
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
      if (request.kind === 'obsidian-command' && persistence?.getObsidianCommands) {
        const commandId = request.commandId?.trim();
        return !!commandId && persistence.getObsidianCommands().includes(commandId);
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
      if (request.kind === 'obsidian-command' && request.commandId) {
        if (persistence?.persistObsidianCommand) {
          await persistence.persistObsidianCommand(request.commandId);
        }
        cache.rememberObsidianCommand(request.commandId);
      }
      return result;
    },
  };
}
