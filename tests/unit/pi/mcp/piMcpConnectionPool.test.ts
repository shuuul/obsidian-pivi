import { PiMcpConnectionPool } from '@pivi/pivi-agent-core/mcp/piMcpConnectionPool';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

const mockClients: Array<{
  connect: jest.Mock;
  listTools: jest.Mock;
  close: jest.Mock;
}> = [];
const mockTransports: Array<{ close: jest.Mock }> = [];
const mockConnectPromises: Promise<void>[] = [];

jest.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: class MockClient {
    connect = jest.fn(() => mockConnectPromises.shift() ?? Promise.resolve());
    listTools = jest.fn(async () => ({ tools: [] }));
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

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockTransport {
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

const stdioServer: ManagedMcpServer = {
  name: 'local',
  enabled: true,
  contextSaving: true,
  stdioActivationConfirmed: true,
  config: { type: 'stdio', command: 'node', args: ['server.js'] },
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
    // authorizeStdioLaunch is async even for remote servers, so Client construction
    // happens on a subsequent microtask.
    await Promise.resolve();
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

  it('authorizes every new stdio launch but not reuse of a live connection', async () => {
    const requireAuthorized = jest.fn(async () => {});
    const pool = new PiMcpConnectionPool(
      null,
      jest.fn(),
      {},
      undefined,
      undefined,
      { requireAuthorized } as never,
    );

    await pool.listTools(stdioServer);
    await pool.listTools(stdioServer);
    expect(requireAuthorized).toHaveBeenCalledTimes(1);

    await pool.close(stdioServer.name);
    await pool.listTools(stdioServer);
    expect(requireAuthorized).toHaveBeenCalledTimes(2);
    await pool.dispose();
  });

  it('reauthorizes a stdio launch after a failed connection attempt', async () => {
    const requireAuthorized = jest.fn(async () => {});
    mockConnectPromises.push(Promise.reject(new Error('connect failed')));
    const pool = new PiMcpConnectionPool(
      null,
      jest.fn(),
      {},
      undefined,
      undefined,
      { requireAuthorized } as never,
    );

    await expect(pool.listTools(stdioServer)).rejects.toThrow('connect failed');
    await expect(pool.listTools(stdioServer)).resolves.toEqual([]);
    expect(requireAuthorized).toHaveBeenCalledTimes(2);
    await pool.dispose();
  });
});
