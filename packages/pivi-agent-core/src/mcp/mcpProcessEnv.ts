import { getEnhancedPath } from './env';
import type { McpProcessEnv } from './ports';
import type { ManagedMcpServer } from './types';

/**
 * Cross-platform parent variables inherited by stdio MCP children.
 * Only these keys are copied from the injected process environment; everything
 * else must be named explicitly in the server configuration.
 */
export const MCP_STDIO_PARENT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TERM',
  'VOLTA_HOME',
  'NVM_BIN',
  'NVM_SYMLINK',
  'NVM_HOME',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
] as const;

const ALLOWED_PARENT_ENV_KEYS = new Set<string>(MCP_STDIO_PARENT_ENV_ALLOWLIST);

function pickAllowedParentEnv(processEnv: McpProcessEnv): McpProcessEnv {
  const picked: McpProcessEnv = {};
  for (const key of ALLOWED_PARENT_ENV_KEYS) {
    const value = processEnv[key];
    if (typeof value === 'string') {
      picked[key] = value;
    }
  }
  return picked;
}

export function resolveMcpBearerToken(
  server: ManagedMcpServer,
  processEnv: McpProcessEnv,
): string | undefined {
  if (server.bearerToken) {
    return server.bearerToken;
  }
  if (server.bearerTokenEnv) {
    return processEnv[server.bearerTokenEnv];
  }
  return undefined;
}

export function buildMcpStdioEnv(
  processEnv: McpProcessEnv,
  serverEnv: Record<string, string> | undefined,
): Record<string, string> {
  const merged: McpProcessEnv = {
    ...pickAllowedParentEnv(processEnv),
    ...serverEnv,
    PATH: getEnhancedPath(processEnv, serverEnv?.PATH),
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}
