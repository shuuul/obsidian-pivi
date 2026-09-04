import type { ResolveConfigValueHost } from '../config/valueSource';
import { readSecretAcrossIds } from '../config/valueSource';
import type { SyncSecretStore } from '../ports';
import {
  type McpStoredValueMap,
  resolveMcpValueMap,
} from './mcpValueSources';
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

export function createMcpResolveHost(
  processEnv: McpProcessEnv,
  secretStorage?: SyncSecretStore,
): ResolveConfigValueHost {
  return {
    getSecret(secretId: string) {
      if (!secretStorage) {
        return undefined;
      }
      return readSecretAcrossIds(secretStorage, [secretId]);
    },
    getSystemEnvironmentVariable(name: string) {
      return processEnv[name];
    },
  };
}

export function resolveMcpHeaders(
  serverName: string,
  storedHeaders: McpStoredValueMap | undefined,
  host: ResolveConfigValueHost,
  secretStorage?: SyncSecretStore,
): Record<string, string> {
  return resolveMcpValueMap(serverName, 'header', storedHeaders, host, secretStorage);
}
