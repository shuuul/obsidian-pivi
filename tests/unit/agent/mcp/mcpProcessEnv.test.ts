import { getMcpValueSecretId } from '@pivi/agent/config/valueSource';
import {
  createMcpResolveHost,
  resolveMcpBearerToken,
  resolveMcpHeaders,
} from '@pivi/agent/mcp/mcpProcessEnv';
import type { ManagedMcpServer } from '@pivi/agent/mcp/types';
import type { SyncSecretStore } from '@pivi/agent/ports';

function bearerServer(overrides: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'remote',
    enabled: true,
    contextSaving: false,
    config: { type: 'http', url: 'https://mcp.example.com' },
    ...overrides,
  };
}

function memorySecretStore(initial: Record<string, string> = {}): SyncSecretStore {
  const values = new Map(Object.entries(initial));
  return {
    getSecret: id => values.get(id) ?? null,
    setSecret: (id, value) => { values.set(id, value); },
    listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
  };
}

describe('mcpProcessEnv', () => {
  it('uses explicit bearer tokens before injected environment variables', () => {
    const server = bearerServer({
      bearerToken: 'explicit-token',
      bearerTokenEnv: 'MCP_TOKEN',
    });

    expect(resolveMcpBearerToken(server, { MCP_TOKEN: 'env-token' })).toBe(
      'explicit-token',
    );
  });

  it('resolves bearer tokens from the injected environment', () => {
    const original = process.env.MCP_TOKEN;
    process.env.MCP_TOKEN = 'global-token';
    try {
      const server = bearerServer({ bearerTokenEnv: 'MCP_TOKEN' });

      expect(resolveMcpBearerToken(server, { MCP_TOKEN: 'injected-token' })).toBe(
        'injected-token',
      );
    } finally {
      if (original === undefined) {
        delete process.env.MCP_TOKEN;
      } else {
        process.env.MCP_TOKEN = original;
      }
    }
  });

  it('returns undefined when no bearer token or env name is configured', () => {
    expect(resolveMcpBearerToken(bearerServer(), { MCP_TOKEN: 'env-token' })).toBeUndefined();
  });

  it('returns undefined for an env bearer when the injected map has no matching key', () => {
    expect(resolveMcpBearerToken(bearerServer({ bearerTokenEnv: 'MCP_TOKEN' }), {})).toBeUndefined();
  });

  it('reads secrets and process env through the resolve host', () => {
    const secretId = getMcpValueSecretId('remote', 'header', 'Authorization');
    const host = createMcpResolveHost(
      { MCP_API_KEY: 'from-env' },
      memorySecretStore({ [secretId]: 'from-secret' }),
    );

    expect(host.getSecret(secretId)).toBe('from-secret');
    expect(host.getSecret('missing')).toBeUndefined();
    expect(host.getSystemEnvironmentVariable('MCP_API_KEY')).toBe('from-env');
    expect(host.getSystemEnvironmentVariable('MISSING')).toBeUndefined();
  });

  it('returns undefined secrets when no secret store is injected', () => {
    const host = createMcpResolveHost({ MCP_API_KEY: 'from-env' });

    expect(host.getSecret('any-id')).toBeUndefined();
    expect(host.getSystemEnvironmentVariable('MCP_API_KEY')).toBe('from-env');
  });

  it('resolves stored MCP headers from plain, env, and secret refs', () => {
    const secretId = getMcpValueSecretId('remote', 'header', 'Authorization');
    const secretStorage = memorySecretStore({ [secretId]: 'secret-token' });
    const host = createMcpResolveHost({ MCP_USER: 'alice' }, secretStorage);

    expect(resolveMcpHeaders('remote', undefined, host, secretStorage)).toEqual({});
    expect(resolveMcpHeaders('remote', {
      'X-Plain': { kind: 'plain', value: 'plain-value' },
      'X-User': { kind: 'systemEnvironment', name: 'MCP_USER' },
      Authorization: { kind: 'secret' },
    }, host, secretStorage)).toEqual({
      'X-Plain': 'plain-value',
      'X-User': 'alice',
      Authorization: 'secret-token',
    });
  });

  it('omits secret headers when no secret store is injected', () => {
    const host = createMcpResolveHost({});

    expect(resolveMcpHeaders('remote', {
      Authorization: { kind: 'secret' },
    }, host)).toEqual({});
  });
});
