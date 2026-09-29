import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpTestResult,
  McpTool,
} from '@pivi/agent/mcp/types';

export interface SettingsMcpPort {
    load(): Promise<readonly ManagedMcpServer[]>;
    /** Cached tools currently known for one server; never opens a connection. */
    listTools(serverName: string): Promise<readonly McpTool[]>;
    save(servers: readonly ManagedMcpServer[]): Promise<void>;
    /** Authenticate when needed, fetch the tool inventory, and update the shared cache. */
    connect(server: ManagedMcpServer): Promise<{
      readonly authStatus: McpAuthStatus | null;
      readonly result: McpTestResult;
    }>;
    /** Null when workspace-scoped MCP OAuth is unavailable. */
    getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus | null>;
    /** Clear stored OAuth credentials and reconnect active MCP consumers. */
    logout(serverName: string): Promise<void>;
}
