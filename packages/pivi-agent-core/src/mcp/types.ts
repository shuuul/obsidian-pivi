/** MCP (Model Context Protocol) type definitions used by the shared manager/UI. */

import {
  isLegacyPlainStringMap,
  isMcpStoredValueMap,
  type McpStoredValueMap,
} from './mcpValueSources';

/** Persisted structured map; UI drafts may supply legacy plain strings until save. */
export type McpConfigValueMap = McpStoredValueMap | Record<string, string>;

/** Stdio server configuration (local command-line programs). */
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: McpConfigValueMap;
}

/** Server-Sent Events remote server configuration. */
export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: McpConfigValueMap;
}

/** HTTP remote server configuration. */
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
  /**
   * Stdio servers stay inactive until the exact executable, args, cwd, and env
   * var names are confirmed. Remote servers are always treated as confirmed.
   */
  stdioActivationConfirmed?: boolean;
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
        /** Stdio activation confirmation; omitted/false keeps the server inactive. */
        stdioActivationConfirmed?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMcpConfigValueMap(value: unknown): value is McpConfigValueMap {
  return isLegacyPlainStringMap(value) || isMcpStoredValueMap(value);
}

function hasOptionalMcpConfigValueMap(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isMcpConfigValueMap(value[key]);
}

export function isMcpStdioServerConfig(obj: unknown): obj is McpStdioServerConfig {
  if (!isRecord(obj)) {
    return false;
  }

  return (obj.type === undefined || obj.type === 'stdio')
    && typeof obj.command === 'string'
    && (obj.args === undefined || isStringArray(obj.args))
    && hasOptionalMcpConfigValueMap(obj, 'env');
}

export function isMcpSseServerConfig(obj: unknown): obj is McpSSEServerConfig {
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
  return isMcpStdioServerConfig(obj)
    || isMcpSseServerConfig(obj)
    || isMcpHttpServerConfig(obj);
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
