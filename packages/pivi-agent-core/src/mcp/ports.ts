import type { WorkspaceFileStore } from '@pivi/pivi-agent-core/ports';

import type { ManagedMcpServer, McpAuthStatus, McpTestResult } from './types';

export type FileStore = WorkspaceFileStore;


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

export interface AppMcpStorage {
  load(): Promise<ManagedMcpServer[]>;
  save(servers: ManagedMcpServer[]): Promise<void>;
  tryParseClipboardConfig?(text: string): unknown;
}

export interface AppMcpToolSummary {
  name: string;
  description?: string;
}

export interface AppMcpToolProvider {
  listTools(serverName: string): Promise<AppMcpToolSummary[]>;
  dispose(): Promise<void>;
  invalidate?(serverName?: string): void;
  invalidateAll?(): void;
  prefetchEnabledServers?(): Promise<void>;
}

export interface AppMcpServerProbeResult {
  toolCount: number;
}

export interface AppMcpServerProbeProvider {
  testServer(serverName: string): Promise<AppMcpServerProbeResult>;
}

export interface AppMcpServerTester {
  testServer(server: ManagedMcpServer): Promise<McpTestResult>;
}
