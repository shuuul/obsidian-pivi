import type { McpServerManager } from '@pivi/pivi-agent-core/mcp/mcpServerManager';
import type { McpOAuthService } from '@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

import { PiMcpToolProvider } from '@/app/workspace/workspaceServiceProviders';

const listTools = jest.fn();
const close = jest.fn(async () => {});
const closeAll = jest.fn(async () => {});
const dispose = jest.fn(async () => {});

jest.mock('@pivi/pivi-agent-core/mcp/piMcpConnectionPool', () => ({
  PiMcpConnectionPool: class MockPiMcpConnectionPool {
    listTools = listTools;
    close = close;
    closeAll = closeAll;
    dispose = dispose;
  },
}));

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createServer(name = 'github'): ManagedMcpServer {
  return {
    name,
    config: { type: 'http', url: `https://${name}.example.com` },
    enabled: true,
    contextSaving: true,
  };
}

function createProvider(servers: ManagedMcpServer[]): PiMcpToolProvider {
  const manager = {
    getServers: () => servers,
  } as Pick<McpServerManager, 'getServers'>;
  return new PiMcpToolProvider(
    manager as McpServerManager,
    {} as McpOAuthService,
  );
}

describe('PiMcpToolProvider', () => {
  beforeEach(() => {
    listTools.mockReset();
    close.mockClear();
    closeAll.mockClear();
    dispose.mockClear();
  });

  it('coalesces concurrent tool-list requests for the same server', async () => {
    const deferred = createDeferred<Array<{ name: string; description?: string }>>();
    listTools.mockReturnValue(deferred.promise);
    const provider = createProvider([createServer()]);

    const first = provider.listTools('github');
    const second = provider.listTools('github');
    deferred.resolve([{ name: 'search', description: 'Search files' }]);

    await expect(first).resolves.toEqual([{ name: 'search', description: 'Search files' }]);
    await expect(second).resolves.toEqual([{ name: 'search', description: 'Search files' }]);
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('does not let an invalidated request repopulate the cache', async () => {
    const stale = createDeferred<Array<{ name: string }>>();
    const fresh = createDeferred<Array<{ name: string }>>();
    listTools
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const provider = createProvider([createServer()]);

    const staleRequest = provider.listTools('github');
    provider.invalidate('github');
    expect(close).toHaveBeenCalledWith('github');
    const freshRequest = provider.listTools('github');
    fresh.resolve([{ name: 'fresh' }]);
    stale.resolve([{ name: 'stale' }]);

    await expect(staleRequest).resolves.toEqual([{ name: 'stale' }]);
    await expect(freshRequest).resolves.toEqual([{ name: 'fresh' }]);
    await expect(provider.listTools('github')).resolves.toEqual([{ name: 'fresh' }]);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('invalidates all in-flight requests without cross-server cache writes', async () => {
    const githubStale = createDeferred<Array<{ name: string }>>();
    const linearStale = createDeferred<Array<{ name: string }>>();
    listTools
      .mockReturnValueOnce(githubStale.promise)
      .mockReturnValueOnce(linearStale.promise)
      .mockResolvedValueOnce([{ name: 'github-fresh' }])
      .mockResolvedValueOnce([{ name: 'linear-fresh' }]);
    const provider = createProvider([createServer('github'), createServer('linear')]);

    const oldGithub = provider.listTools('github');
    const oldLinear = provider.listTools('linear');
    provider.invalidateAll();
    expect(closeAll).toHaveBeenCalledTimes(1);
    const newGithub = provider.listTools('github');
    const newLinear = provider.listTools('linear');
    githubStale.resolve([{ name: 'github-stale' }]);
    linearStale.resolve([{ name: 'linear-stale' }]);

    await Promise.all([oldGithub, oldLinear, newGithub, newLinear]);
    await expect(provider.listTools('github')).resolves.toEqual([{ name: 'github-fresh' }]);
    await expect(provider.listTools('linear')).resolves.toEqual([{ name: 'linear-fresh' }]);
    expect(listTools).toHaveBeenCalledTimes(4);
  });

  it('disposes its connection pool', async () => {
    const provider = createProvider([createServer()]);

    await provider.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
