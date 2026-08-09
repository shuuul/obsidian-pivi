import { PiMcpConnectionPool } from '@pivi/agent/mcp/piMcpConnectionPool';
import type { ManagedMcpServer } from '@pivi/agent/mcp/types';

const mockClients: Array<{
  connect: jest.Mock;
  listTools: jest.Mock;
  callTool: jest.Mock;
  close: jest.Mock;
}> = [];
const mockTransports: Array<{ close: jest.Mock }> = [];
const mockConnectPromises: Promise<void>[] = [];

jest.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: class MockClient {
    connect = jest.fn(() => mockConnectPromises.shift() ?? Promise.resolve());
    listTools = jest.fn(async () => ({ tools: [] }));
    callTool = jest.fn();
    close = jest.fn(async () => {});

    constructor() {
      mockClients.push(this);
    }
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockTransport {
    close = jest.fn(async () => {});

    constructor() {
      mockTransports.push(this);
    }
  },
}));

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const server: ManagedMcpServer = {
  name: 'github',
  enabled: true,
  contextSaving: true,
  config: { type: 'http', url: 'https://github.example.com' },
};

describe('PiMcpConnectionPool', () => {
  beforeEach(() => {
    mockClients.length = 0;
    mockTransports.length = 0;
    mockConnectPromises.length = 0;
  });

  it('closes an in-flight connection completed during disposal without caching it', async () => {
    const connected = createDeferred();
    mockConnectPromises.push(connected.promise);
    const pool = new PiMcpConnectionPool(null, jest.fn(), {});
    const listPromise = pool.listTools(server);
    expect(mockClients).toHaveLength(1);
    mockClients[0]?.listTools.mockResolvedValue({ tools: [] });

    const disposePromise = pool.dispose();
    connected.resolve();

    await expect(listPromise).rejects.toThrow('was invalidated');
    await expect(disposePromise).resolves.toBeUndefined();
    expect(mockClients[0]?.close).toHaveBeenCalledTimes(1);
    expect(mockTransports[0]?.close).toHaveBeenCalledTimes(1);
    await expect(pool.listTools(server)).rejects.toThrow('is disposed');
  });

  it('aborts an active tool call before waiting for connection retirement', async () => {
    const pool = new PiMcpConnectionPool(null, jest.fn(), {});
    const callStarted = createDeferred();
    const call = pool.callTool(server, 'search', {});
    await Promise.resolve();
    mockClients[0]?.callTool.mockImplementation(
      (_request, _options, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        callStarted.resolve();
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    await callStarted.promise;
    const dispose = pool.dispose();

    await expect(call).rejects.toThrow('aborted');
    await expect(dispose).resolves.toBeUndefined();
    expect(mockClients[0]?.callTool.mock.calls[0]?.[2].signal.aborted).toBe(true);
  });
});
