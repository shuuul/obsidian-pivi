import type { ManagedMcpServer, McpAuthStatus } from '@pivi/pivi-agent-core/mcp/types';
import type { McpTestResult } from '@pivi/pivi-agent-core/mcp/types';

import type { AgentHostContext } from './bootstrap/hostContext';
import type { SharedAppStorage } from './bootstrap/storage';
import type { FileStore, HomeFileStore } from "./fileStore";

export interface AppMcpStorage {
  load(): Promise<ManagedMcpServer[]>;
  save(servers: ManagedMcpServer[]): Promise<void>;
  tryParseClipboardConfig?(text: string): unknown;
}

/** Vault-local MCP OAuth (`.pivi/mcp-oauth/`). */
export interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}

export interface AppMcpToolSummary {
  name: string;
  description?: string;
}

export interface AppMcpToolProvider {
  listTools(serverName: string): Promise<AppMcpToolSummary[]>;
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

export type AppModelReadinessStatusKind =
  | 'ready'
  | 'missing-credential'
  | 'oauth-expired'
  | 'disabled'
  | 'unavailable';

export interface AppModelReadinessStatus {
  kind: AppModelReadinessStatusKind;
  label: string;
  description: string;
}

export interface AppModelTestResult {
  ok: boolean;
  detail: string;
}

export interface AppModelReadinessProvider {
  getStatus(
    model: string,
    settings: Record<string, unknown>,
  ): AppModelReadinessStatus;
  testModel(
    model: string,
    settings: Record<string, unknown>,
  ): Promise<AppModelTestResult>;
}

export interface AppSkillSummary {
  name: string;
  description?: string;
}

export interface AppSkillProvider {
  listSkills(): AppSkillSummary[];
}

export interface AgentSettingsTabRendererContext {
  host: AgentHostContext;
  refreshModelSelectors(): void;
  onEnvironmentChanged?(): void;
}

export interface AgentSettingsTabRenderer {
  renderModels(
    container: HTMLElement,
    context: AgentSettingsTabRendererContext,
  ): void;
  renderSkills(
    container: HTMLElement,
    context: AgentSettingsTabRendererContext,
  ): void;
}

export interface WorkspaceInitContext {
  host: AgentHostContext;
  storage: SharedAppStorage;
  vaultAdapter: FileStore;
  homeAdapter: HomeFileStore;
}
