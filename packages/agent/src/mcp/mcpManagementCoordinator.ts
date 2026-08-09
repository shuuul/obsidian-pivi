import type { SyncSecretStore } from '../ports';
import type {
  AgentMcpServerSummary,
  PiviMcpInput,
  PiviMcpListResult,
  PiviMcpTestResult,
} from '../tools/piviManagement';
import { PiviManagementError } from '../tools/piviManagement';
import { McpManagementPersistence } from './mcpManagementPersistence';
import {
  hydrateMcpDirectSecrets,
  redactMcpServer,
  toMcpTestResult,
} from './mcpManagementProjection';
import type { McpStorage } from './mcpStorage';
import type { AppMcpServerTester, AppMcpToolProvider } from './ports';
import type { ManagedMcpServer } from './types';

export type McpManagementMutation = Extract<PiviMcpInput, { action: 'upsert' | 'set_enabled' | 'remove' }>;

export interface McpManagementPlan {
  revision: string;
  mutation: McpManagementMutation;
}

export interface McpManagementCommitResult {
  revision: string;
  saved: true;
  refreshed: boolean;
  effective?: AgentMcpServerSummary;
  removedName?: string;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}

export interface McpManagementSettingsSnapshot {
  servers: ManagedMcpServer[];
  revision: string;
}

export interface McpManagementCoordinatorOptions {
  storage: McpStorage;
  toolProvider: AppMcpToolProvider;
  tester: AppMcpServerTester;
  secretStorage?: SyncSecretStore;
  removeOAuthArtifacts?(serverName: string): Promise<void>;
  publish?(servers: readonly ManagedMcpServer[], changedName: string): Promise<void> | void;
}

/** Shared serialized MCP transaction service for Settings and future Agent management. */
export class McpManagementCoordinator {
  private readonly persistence: McpManagementPersistence;

  constructor(private readonly options: McpManagementCoordinatorOptions) {
    this.persistence = new McpManagementPersistence(options);
  }

  async query(): Promise<PiviMcpListResult> {
    const servers = await this.options.storage.loadSnapshot();
    return {
      servers: servers.map((server) => redactMcpServer(
        server,
        this.options.toolProvider.getCachedTools(server.name),
        this.options.secretStorage,
      )),
    };
  }

  async test(name: string, signal?: AbortSignal): Promise<PiviMcpTestResult> {
    const servers = await this.options.storage.loadSnapshot();
    const server = servers.find((candidate) => candidate.name === name);
    if (!server) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${name}`);
    hydrateMcpDirectSecrets(server, this.options.secretStorage);
    // Agent diagnostics deliberately use the non-interactive tester. The Settings
    // diagnostics pool may invoke OAuth refresh/provider persistence.
    const result = await this.options.tester.testServer(server, signal);
    return toMcpTestResult(name, result);
  }

  async plan(mutation: McpManagementMutation): Promise<McpManagementPlan> {
    const snapshot = await this.options.storage.loadRevisionedSnapshot();
    return { revision: snapshot.revision, mutation };
  }

  async getRevision(): Promise<string> {
    return (await this.options.storage.loadRevisionedSnapshot()).revision;
  }

  /** Settings-ready servers and CAS revision derived from one authoritative read. */
  async loadSettingsSnapshot(): Promise<McpManagementSettingsSnapshot> {
    const snapshot = await this.options.storage.loadRevisionedSnapshot();
    snapshot.servers.forEach(server => hydrateMcpDirectSecrets(server, this.options.secretStorage));
    return snapshot;
  }

  commit(
    plan: McpManagementPlan,
    expectedRevision = plan.revision,
    signal?: AbortSignal,
  ): Promise<McpManagementCommitResult> {
    return this.persistence.commit(plan, expectedRevision, signal).then((result) => {
      if (!result.effectiveServer) {
        return result;
      }
      try {
        const { effectiveServer, ...commitResult } = result;
        return {
          ...commitResult,
          effective: redactMcpServer(effectiveServer, [], this.options.secretStorage),
        };
      } catch (cause) {
        const { effectiveServer: _effectiveServer, ...commitResult } = result;
        return {
          ...commitResult,
          refreshed: false,
          effective: undefined,
          warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
          refreshFailures: [
            ...(result.refreshFailures ?? []),
            { target: 'projection', message: cause instanceof Error ? cause.message : 'Unknown failure' },
          ].slice(0, 20),
        };
      }
    });
  }

  async replaceAll(servers: readonly ManagedMcpServer[], expectedRevision: string): Promise<McpManagementCommitResult> {
    return this.persistence.replaceAll(servers, expectedRevision);
  }

}
