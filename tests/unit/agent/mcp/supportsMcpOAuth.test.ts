import type { ManagedMcpServer } from '@pivi/agent/mcp/types';
import { supportsMcpOAuth } from '@pivi/agent/mcp/types';

function remoteServer(overrides: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'remote',
    config: { type: 'http', url: 'https://mcp.example.com' },
    enabled: true,
    contextSaving: false,
    ...overrides,
  };
}

describe('supportsMcpOAuth', () => {
  it('returns true for remote servers with default auth', () => {
    expect(supportsMcpOAuth(remoteServer())).toBe(true);
  });

  it('returns false when oauth is disabled', () => {
    expect(supportsMcpOAuth(remoteServer({ oauth: false, auth: 'none' }))).toBe(false);
  });

  it('returns false for bearer auth', () => {
    expect(supportsMcpOAuth(remoteServer({ auth: 'bearer', bearerToken: 'x' }))).toBe(false);
  });
});
