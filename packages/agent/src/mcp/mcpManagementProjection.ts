import { isSecretLikeKey } from '../foundation/configValueSource';
import type { SyncSecretStore } from '../ports';
import type {
  AgentMcpSecretProjection,
  AgentMcpServerSummary,
} from '../tools/piviManagement';
import { listMcpServerSecretIds } from './mcpStorage';
import { normalizeMcpStoredValueMap } from './mcpValueSources';
import type { AppMcpToolProvider } from './ports';
import type { ManagedMcpServer, McpTestResult } from './types';
import { getMcpServerType } from './types';

function projectRef(ref: { kind: string; value?: string; name?: string }): AgentMcpSecretProjection {
  if (ref.kind === 'secret') return { source: 'secret', configured: true };
  if (ref.kind === 'systemEnvironment') {
    return { source: 'systemEnvironment', variable: ref.name ?? '' };
  }
  return { source: 'plain', value: ref.value ?? '' };
}

function projectMap(raw: unknown): Record<string, AgentMcpSecretProjection> | undefined {
  const map = normalizeMcpStoredValueMap(raw);
  if (!map) return undefined;
  return Object.fromEntries(Object.entries(map).map(([key, ref]) => [
    key,
    isSecretLikeKey(key) && ref.kind === 'plain'
      ? { source: 'secret', configured: (ref.value?.length ?? 0) > 0 }
      : projectRef(ref),
  ]));
}

function hasSecret(storage: SyncSecretStore | undefined, ids: readonly string[]): boolean {
  return !!storage && ids.some((id) => !!storage.getSecret(id));
}

export function redactMcpServer(
  server: ManagedMcpServer,
  tools: ReturnType<AppMcpToolProvider['getCachedTools']> = [],
  secretStorage?: SyncSecretStore,
): AgentMcpServerSummary {
  const type = getMcpServerType(server.config);
  const common = {
    name: server.name,
    type,
    enabled: server.enabled,
    contextSaving: server.contextSaving,
    ...(server.description ? { description: server.description } : {}),
    ...(server.disabledTools ? { disabledTools: [...server.disabledTools] } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ ...tool })) } : {}),
  };
  if (type === 'stdio') {
    const config = server.config as { command: string; args?: string[]; env?: unknown };
    const env = projectMap(config.env);
    return {
      ...common,
      command: config.command,
      ...(config.args ? { args: [...config.args] } : {}),
      ...(env ? { env } : {}),
    };
  }
  const config = server.config as { url: string; headers?: unknown };
  const oauth = server.oauth === false
    ? false
    : server.oauth
      ? {
          ...(server.oauth.grantType ? { grantType: server.oauth.grantType } : {}),
          ...(server.oauth.clientId ? { clientId: server.oauth.clientId } : {}),
          ...(server.oauth.scope ? { scope: server.oauth.scope } : {}),
          clientSecret: server.oauth.clientSecret || hasSecret(secretStorage, listMcpServerSecretIds(server.name, 'client-secret'))
            ? { source: 'secret' as const, configured: true }
            : { source: 'none' as const },
        }
      : undefined;
  const headers = projectMap(config.headers);
  return {
    ...common,
    url: config.url,
    auth: server.auth ?? 'none',
    ...(headers ? { headers } : {}),
    bearerToken: server.bearerToken || hasSecret(secretStorage, listMcpServerSecretIds(server.name, 'bearer-token'))
      ? { source: 'secret', configured: true }
      : server.bearerTokenEnv
        ? { source: 'systemEnvironment', variable: server.bearerTokenEnv }
        : { source: 'none' },
    ...(oauth !== undefined ? { oauth } : {}),
  };
}

export function hydrateMcpDirectSecrets(
  server: ManagedMcpServer,
  secretStorage?: SyncSecretStore,
): void {
  const read = (kind: 'bearer-token' | 'client-secret') => {
    for (const id of listMcpServerSecretIds(server.name, kind)) {
      const value = secretStorage?.getSecret(id);
      if (value) return value;
    }
    return undefined;
  };
  if (server.auth === 'bearer') server.bearerToken = read('bearer-token');
  if (server.oauth && typeof server.oauth === 'object') {
    const clientSecret = read('client-secret');
    if (clientSecret) server.oauth = { ...server.oauth, clientSecret };
  }
}

export function toMcpTestResult(name: string, result: McpTestResult) {
  const authenticationRequired = !result.success
    && /\b(401|403|unauthori[sz]ed|authentication required|not authenticated)\b/i.test(result.error ?? '');
  const error = result.error
    ? authenticationRequired
      ? 'Authentication required.'
      : /\b(time(?:d? out)|timeout)\b/i.test(result.error)
        ? 'Connection timed out.'
        : /\b(cancel(?:led)?|abort(?:ed)?)\b/i.test(result.error)
          ? 'Connection cancelled.'
          : /\b(invalid|missing|malformed|unsupported|configuration|executable)\b/i.test(result.error)
            ? 'Invalid server configuration.'
            : 'Connection failed.'
    : undefined;
  return {
    name,
    success: result.success,
    ...(authenticationRequired ? { authenticationRequired: true } : {}),
    ...(result.serverVersion ? { serverVersion: result.serverVersion } : {}),
    ...(result.tools.length ? { tools: result.tools.map(({ name: toolName, description }) => ({ name: toolName, ...(description ? { description } : {}) })) } : {}),
    ...(error ? { error } : {}),
  };
}
