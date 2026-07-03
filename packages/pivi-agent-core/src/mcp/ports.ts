import type { SyncSecretStore, WorkspaceFileStore } from '@pivi/pivi-agent-core/ports';

import type { ManagedMcpServer, McpAuthStatus } from './types';

export type FileStore = WorkspaceFileStore;

export type SecretStorageLike = SyncSecretStore;

export type McpTransportFetch = typeof fetch;

export type McpProcessEnv = Record<string, string | undefined>;

export interface PreparedMcpTurn {
  mcpMentions: Set<string>;
  request: Record<string, unknown> & {
    enabledMcpServers?: Set<string>;
  };
}

export interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}
