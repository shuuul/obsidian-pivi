import type { ManagedMcpServer } from '@pivi/agent/mcp/types';

const listTools = jest.fn();
const close = jest.fn();

jest.mock('@earendil-works/pi-mcp', () => ({
  McpClient: jest.fn().mockImplementation(() => ({
    connect: async () => ({ serverInfo: { name: 'safe-server', version: '1.0.0' } }),
    listTools,
    close,
  })),
  StreamableHttpTransport: jest.fn().mockImplementation(() => ({ close: jest.fn(async () => {}) })),
}));

import { testMcpServer } from '@pivi/agent/mcp/mcpServerTester';

const server: ManagedMcpServer = {
  name: 'safe-server',
  config: { type: 'http', url: 'https://safe.example.test/mcp' },
  enabled: true,
  contextSaving: true,
};

function serializedWarnings(spy: jest.SpiedFunction<typeof console.warn>): string {
  return JSON.stringify(spy.mock.calls);
}

describe('testMcpServer Agent-safe logging', () => {
  beforeEach(() => {
    listTools.mockReset().mockResolvedValue([]);
    close.mockReset().mockResolvedValue(undefined);
  });

  it('does not expose a listTools failure sentinel in the result or logs', async () => {
    const sentinel = 'LIST_TOOLS_SECRET_SENTINEL';
    listTools.mockRejectedValue(new Error(sentinel));
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await testMcpServer(server, jest.fn(), {}, undefined);

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(serializedWarnings(warnings)).not.toContain(sentinel);
    expect(warnings).toHaveBeenCalledWith('[Pivi:McpServerTester] MCP test tool listing failed');
    warnings.mockRestore();
  });

  it('does not expose a close failure sentinel in the result or logs', async () => {
    const sentinel = 'CLOSE_SECRET_SENTINEL';
    close.mockRejectedValue(new Error(sentinel));
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await testMcpServer(server, jest.fn(), {}, undefined);

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(serializedWarnings(warnings)).not.toContain(sentinel);
    expect(warnings).toHaveBeenCalledWith('[Pivi:McpServerTester] MCP test client close failed');
    warnings.mockRestore();
  });

  it('reports the server identity and tools on success', async () => {
    listTools.mockResolvedValue([{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }]);

    await expect(testMcpServer(server, jest.fn(), {}, undefined)).resolves.toEqual({
      success: true,
      serverName: 'safe-server',
      serverVersion: '1.0.0',
      tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }],
    });
  });

  it('reports an aborted connection as a failed test', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      testMcpServer(server, jest.fn(), {}, undefined, controller.signal),
    ).resolves.toMatchObject({
      success: false,
      error: 'Connection aborted',
    });
  });
});
