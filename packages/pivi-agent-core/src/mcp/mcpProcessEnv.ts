import { getEnhancedPath } from './env';
import type { McpProcessEnv } from './ports';
import type { ManagedMcpServer } from './types';

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
    ...processEnv,
    ...serverEnv,
    PATH: getEnhancedPath(processEnv, serverEnv?.PATH),
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}
