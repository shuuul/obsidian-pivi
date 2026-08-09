import type { ManagedMcpServer } from '@pivi/agent/mcp/types';

const connect = jest.fn();
const listTools = jest.fn();
const close = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect,
    listTools,
    close,
    getServerVersion: () => ({ name: 'safe-server', version: '1.0.0' }),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({})),
}));

import { testPiMcpServer } from '@pivi/agent/mcp/piMcpTester';

const server: ManagedMcpServer = {
  name: 'safe-server',
  config: { type: 'http', url: 'https://safe.example.test/mcp' },
  enabled: true,
  contextSaving: true,
};

function serializedWarnings(spy: jest.SpiedFunction<typeof console.warn>): string {
  return JSON.stringify(spy.mock.calls);
}

describe('testPiMcpServer Agent-safe logging', () => {
  beforeEach(() => {
    connect.mockReset().mockResolvedValue(undefined);
    listTools.mockReset().mockResolvedValue({ tools: [] });
    close.mockReset().mockResolvedValue(undefined);
  });

  it('does not expose a listTools failure sentinel in the result or logs', async () => {
    const sentinel = 'LIST_TOOLS_SECRET_SENTINEL';
    listTools.mockRejectedValue(new Error(sentinel));
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await testPiMcpServer(server, jest.fn(), {}, undefined);

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(serializedWarnings(warnings)).not.toContain(sentinel);
    expect(warnings).toHaveBeenCalledWith('[Pivi:PiMcpTester] MCP test tool listing failed');
    warnings.mockRestore();
  });

  it('does not expose a close failure sentinel in the result or logs', async () => {
    const sentinel = 'CLOSE_SECRET_SENTINEL';
    close.mockRejectedValue(new Error(sentinel));
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await testPiMcpServer(server, jest.fn(), {}, undefined);

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(serializedWarnings(warnings)).not.toContain(sentinel);
    expect(warnings).toHaveBeenCalledWith('[Pivi:PiMcpTester] MCP test client close failed');
    warnings.mockRestore();
  });

  it('reports an aborted listTools request as a failed test', async () => {
    listTools.mockRejectedValue(new Error('aborted list request'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      testPiMcpServer(server, jest.fn(), {}, undefined, undefined, controller.signal),
    ).resolves.toMatchObject({
      success: false,
      error: 'Connection aborted',
    });
  });
});
