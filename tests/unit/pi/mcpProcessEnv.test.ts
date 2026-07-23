import * as path from 'node:path';

import {
  buildMcpStdioEnv,
  MCP_STDIO_PARENT_ENV_ALLOWLIST,
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

  it('inherits only the documented allowlist plus explicit server env', () => {
    const parentEnv = {
      PATH: '/base/bin',
      HOME: '/home/user',
      OPENAI_API_KEY: 'secret',
      AWS_SECRET_ACCESS_KEY: 'cloud',
      HTTP_PROXY: 'http://proxy',
      CI: 'true',
      SHARED: 'parent',
    };
    const env = buildMcpStdioEnv(parentEnv, { SERVER_ONLY: 'server', SHARED: 'server-value', PATH: '/server/bin' });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.CI).toBeUndefined();
    expect(env.SERVER_ONLY).toBe('server');
    expect(env.SHARED).toBe('server-value');
    expect(env.HOME).toBe('/home/user');
    expect(env.PATH?.split(path.delimiter)[0]).toBe('/server/bin');
    expect(env.HOME).toBe('/home/user');
    for (const key of MCP_STDIO_PARENT_ENV_ALLOWLIST) {
      if (key === 'PATH' || parentEnv[key as keyof typeof parentEnv] === undefined) {
        continue;
      }
      expect(env[key]).toBe(parentEnv[key as keyof typeof parentEnv]);
    }
  });

  it('retains POSIX and Windows executable discovery essentials from fixtures', () => {
    const posix = buildMcpStdioEnv({ PATH: '/usr/bin', HOME: '/home/pivi', SHELL: '/bin/zsh' }, undefined);
    expect(posix.PATH).toContain('/usr/bin');

    const windows = buildMcpStdioEnv({
      PATH: 'C:\\Windows\\system32',
      USERPROFILE: 'C:\\Users\\pivi',
      APPDATA: 'C:\\Users\\pivi\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\pivi\\AppData\\Local',
      COMSPEC: 'C:\\Windows\\system32\\cmd.exe',
    }, undefined);
    expect(windows.USERPROFILE).toBe('C:\\Users\\pivi');
    expect(windows.PATH).toContain('C:\\Windows\\system32');
  });
});
