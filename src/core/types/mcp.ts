/** MCP (Model Context Protocol) type definitions used by the shared manager/UI. */

/** Stdio server configuration (local command-line programs). */
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Server-Sent Events remote server configuration. */
export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/** HTTP remote server configuration. */
export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/** OAuth settings for remote MCP servers. */
export interface McpOAuthConfig {
  grantType?: 'authorization_code' | 'client_credentials';
  clientId?: string;
  /** Static client secret resolved from Obsidian SecretStorage; not stored in `.pivi/mcp.json`. */
  clientSecret?: string;
  scope?: string;
}

/** OAuth settings persisted in `.pivi/mcp.json` metadata. */
export type StoredMcpOAuthConfig = Omit<McpOAuthConfig, 'clientSecret'>;

export type McpRemoteAuthMode = 'none' | 'bearer' | 'oauth';

/** Union type for all MCP server configurations. */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

/** Server type identifier. */
export type McpServerType = 'stdio' | 'sse' | 'http';

/** Managed MCP server configuration with UI/runtime metadata. */
export interface ManagedMcpServer {
  /** Unique server name (key in mcpServers record). */
  name: string;
  config: McpServerConfig;
  enabled: boolean;
  /** Context-saving mode: hide tools unless referenced with /server/tool. */
  contextSaving: boolean;
  /** Tool names disabled for this server. */
  disabledTools?: string[];
  description?: string;
  /** Remote auth mode (http/sse only). */
  auth?: McpRemoteAuthMode;
  /** OAuth client settings; `false` disables OAuth for this server. */
  oauth?: McpOAuthConfig | false;
  /** Static bearer token for `auth: bearer`, resolved from Obsidian SecretStorage. */
  bearerToken?: string;
  /** Env var name for bearer token (`auth: bearer`). */
  bearerTokenEnv?: string;
}

export type McpAuthStatus =
  | 'authenticated'
  | 'expired'
  | 'not_authenticated'
  | 'not_applicable';

/** MCP configuration file format used by the current CLI integrations. */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/** Extended config file with app-owned server metadata. */
export interface ManagedMcpConfigFile extends McpConfigFile {
  _pivi?: {
    /** Per-server UI/runtime settings. */
    servers: Record<
      string,
      {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: McpRemoteAuthMode;
        oauth?: StoredMcpOAuthConfig | false;
        /** @deprecated Legacy plaintext value migrated into Obsidian SecretStorage. */
        bearerToken?: string;
        bearerTokenEnv?: string;
      }
    >;
  };
}

export function getMcpServerUrl(config: McpServerConfig): string | null {
  if ('url' in config && typeof config.url === 'string') {
    return config.url;
  }
  return null;
}

export function supportsMcpOAuth(server: ManagedMcpServer): boolean {
  if (!getMcpServerUrl(server.config)) {
    return false;
  }
  if (server.oauth === false || server.auth === 'bearer' || server.auth === 'none') {
    return false;
  }
  return server.auth === 'oauth' || server.oauth !== undefined || server.auth === undefined;
}

/** Result of parsing clipboard config. */
export interface ParsedMcpConfig {
  servers: Array<{ name: string; config: McpServerConfig }>;
  needsName: boolean;
}

export function getMcpServerType(config: McpServerConfig): McpServerType {
  if (config.type === 'sse') return 'sse';
  if (config.type === 'http') return 'http';
  if ('url' in config) return 'http'; // URL without explicit type defaults to http
  return 'stdio';
}

export function isValidMcpServerConfig(obj: unknown): obj is McpServerConfig {
  if (!obj || typeof obj !== 'object') return false;
  const config = obj as Record<string, unknown>;

  // Check for stdio (command required)
  if (config.command && typeof config.command === 'string') return true;

  // Check for sse/http (url required, type is optional - defaults to http)
  if (config.url && typeof config.url === 'string') return true;

  return false;
}

export const DEFAULT_MCP_SERVER: Omit<ManagedMcpServer, 'name' | 'config'> = {
  enabled: true,
  contextSaving: true,
};
