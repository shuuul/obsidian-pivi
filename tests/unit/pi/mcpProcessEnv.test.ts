import {
  buildMcpStdioEnv,
  resolveMcpBearerToken,
} from '@pivi/pivi-agent-core/mcp/mcpProcessEnv';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

function bearerServer(overrides: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'remote',
    enabled: true,
    contextSaving: false,
    config: { type: 'http', url: 'https://mcp.example.com' },
    ...overrides,
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

  it('builds stdio transport env from injected process env plus server env', () => {
    const env = buildMcpStdioEnv(
      { BASE_ONLY: 'base', SHARED: 'base-value', PATH: '/base/bin' },
      { SERVER_ONLY: 'server', SHARED: 'server-value', PATH: '/server/bin' },
    );

    expect(env.BASE_ONLY).toBe('base');
    expect(env.SERVER_ONLY).toBe('server');
    expect(env.SHARED).toBe('server-value');
    expect(env.PATH?.split(':')[0]).toBe('/server/bin');
  });
});
