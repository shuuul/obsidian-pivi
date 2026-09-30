/** MCP (Model Context Protocol) type definitions used by the shared manager/UI. */

import {
  isLegacyPlainStringMap,
  isMcpStoredValueMap,
  type McpStoredValueMap,
} from './mcpValueSources';

/** Persisted structured map; UI drafts may supply legacy plain strings until save. */
export type McpConfigValueMap = McpStoredValueMap | Record<string, string>;

/**
 * Legacy HTTP+SSE remote server configuration. Pivi's MCP client speaks only
 * Streamable HTTP, so storage rewrites these entries to disabled `http`
 * servers on load and the user updates the endpoint.
 */
export interface McpLegacySseServerConfig {
  type: 'sse';
  url: string;
  headers?: McpConfigValueMap;
}

/** Streamable HTTP remote server configuration. */
export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: McpConfigValueMap;
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
export type McpServerConfig = McpHttpServerConfig;

/** Server type identifier. */
export type McpServerType = 'http';

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
  /** Remote auth mode. */
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
        /** Legacy plaintext value migrated into Obsidian SecretStorage on load. */
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

export function getMcpServerType(_config: McpServerConfig): McpServerType {
  return 'http';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMcpConfigValueMap(value: unknown): value is McpConfigValueMap {
  return isLegacyPlainStringMap(value) || isMcpStoredValueMap(value);
}

function hasOptionalMcpConfigValueMap(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isMcpConfigValueMap(value[key]);
}

export function isMcpLegacySseServerConfig(obj: unknown): obj is McpLegacySseServerConfig {
  if (!isRecord(obj)) {
    return false;
  }

  return obj.type === 'sse'
    && typeof obj.url === 'string'
    && hasOptionalMcpConfigValueMap(obj, 'headers');
}

export function isMcpHttpServerConfig(obj: unknown): obj is McpHttpServerConfig {
  if (!isRecord(obj)) {
    return false;
  }

  return (obj.type === undefined || obj.type === 'http')
    && typeof obj.url === 'string'
    && hasOptionalMcpConfigValueMap(obj, 'headers');
}

export function isValidMcpServerConfig(obj: unknown): obj is McpServerConfig {
  return isMcpHttpServerConfig(obj);
}

/** Map a legacy SSE entry onto the Streamable HTTP config that replaces it, keeping URL and headers. */
export function upgradeLegacySseServerConfig(config: McpLegacySseServerConfig): McpHttpServerConfig {
  return {
    type: 'http',
    url: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
  };
}

export const DEFAULT_MCP_SERVER: Readonly<Omit<ManagedMcpServer, 'name' | 'config'>> = {
  enabled: true,
  contextSaving: true,
} as const;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTestResult {
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  tools: McpTool[];
  error?: string;
}
