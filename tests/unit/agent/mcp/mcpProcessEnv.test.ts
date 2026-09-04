import { resolveMcpBearerToken } from '@pivi/agent/mcp/mcpProcessEnv';
import type { ManagedMcpServer } from '@pivi/agent/mcp/types';

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
});
