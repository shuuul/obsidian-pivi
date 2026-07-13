import { get } from 'http';

import type { ExternalOpener } from '@pivi/pivi-agent-core/ports';
import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';
import {
  McpAuthFlow,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpAuthFlow';
import {
  OAUTH_CALLBACK_PATH,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpOAuthProvider';
import { McpVaultAuthStore } from '@pivi/pivi-agent-core/mcp/oauth/mcpVaultAuthStore';

const mockRunSdkAuth = jest.fn();
const mockOpenExternalUrl = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
const mockTransportInstances: Array<{
  close: jest.Mock;
  finishAuth: jest.Mock;
  options: { authProvider?: unknown; fetch: McpTransportFetch };
  url: URL;
}> = [];

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+
  return Promise.withResolvers<T>();
}

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: (...args: unknown[]) => mockRunSdkAuth(...args),
  UnauthorizedError: class MockUnauthorizedError extends Error {},
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockTransport {
    readonly close = jest.fn().mockResolvedValue(undefined);
    readonly finishAuth = jest.fn().mockResolvedValue(undefined);

    constructor(
      readonly url: URL,
      readonly options: { authProvider?: unknown; fetch: McpTransportFetch },
    ) {
      mockTransportInstances.push(this);
    }
  },
}));


class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`missing: ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async deleteFolder(): Promise<void> {
    // no-op for memory adapter
  }

  async ensureFolder(): Promise<void> {
    // no-op for memory adapter
  }
}

function server(url = 'https://mcp.example.com'): ManagedMcpServer {
  return {
    name: 'github',
    config: { type: 'http', url },
    enabled: true,
    contextSaving: true,
    auth: 'oauth',
  };
}

function requestCallback(port: number, state: string, code: string): Promise<void> {
  const { promise, resolve, reject } = promiseWithResolvers<void>();
  const req = get(
    `http://localhost:${port}${OAUTH_CALLBACK_PATH}?state=${state}&code=${code}`,
    (res) => {
      res.resume();
      res.on('end', resolve);
    },
  );
  req.on('error', reject);
  return promise;
}

describe('McpAuthFlow', () => {
  let store: McpVaultAuthStore;
  let mockFetch: McpTransportFetch;
  let authFlow: McpAuthFlow;

  beforeEach(() => {
    jest.restoreAllMocks();
    store = new McpVaultAuthStore(new MemoryVaultAdapter() as never);
    mockFetch = jest.fn();
    mockRunSdkAuth.mockReset();
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockResolvedValue(undefined);
    mockTransportInstances.length = 0;
    authFlow = new McpAuthFlow();
  });

  afterEach(async () => {
    await authFlow.shutdown();
    await authFlow.removeAuth('github', store).catch(() => {});
  });

  it('starts an authorization-code flow and completes the pending transport', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    const started = await authFlow.startAuth(server(), store, mockFetch);
    expect(started).toMatchObject({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
    expect(mockTransportInstances).toHaveLength(1);
    const transport = mockTransportInstances[0]!;
    expect(transport.options.fetch).toBe(mockFetch);

    await expect(
      authFlow.completeAuth('github', 'callback-code', started.operationId),
    ).resolves.toBe('authenticated');
    expect(transport.finishAuth).toHaveBeenCalledWith('callback-code');
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('does not reuse stored client information when the server URL changes', async () => {
    await store.updateClientInfo('github', { clientId: 'old-client' }, 'https://old.example.com');
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await expect(provider.clientInformation()).resolves.toBeUndefined();
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    await expect(authFlow.startAuth(server('https://new.example.com'), store, mockFetch)).resolves.toMatchObject({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
  });

  it('opens the authorization URL via injected opener, waits for callback, verifies state, and cleans up state', async () => {
    const { promise: openerCalled, resolve: resolveOpenerCalled } = promiseWithResolvers<void>();
    const opener: ExternalOpener = {
      openExternalUrl: jest.fn(async (url: string) => {
        mockOpenExternalUrl(url);
        resolveOpenerCalled();
      }),
    };
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    const authPromise = authFlow.authenticate(server(), store, mockFetch, opener);
    await openerCalled;

    const oauthState = await store.getOAuthState('github');
    expect(oauthState).toBeTruthy();
    await requestCallback(authFlow.callbackServer.port, oauthState!, 'callback-code');

    await expect(authPromise).resolves.toBe('authenticated');
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(opener.openExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(mockTransportInstances).toHaveLength(1);
    const transport = mockTransportInstances[0]!;
    expect(transport.options.fetch).toBe(mockFetch);
    expect(transport.finishAuth).toHaveBeenCalledWith('callback-code');
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
  });

  it('cleans up OAuth state when the injected opener rejects', async () => {
    const opener: ExternalOpener = {
      openExternalUrl: jest.fn().mockRejectedValue(new Error('browser blocked')),
    };
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    const { promise: neverCallback } = promiseWithResolvers<string>();
    neverCallback.catch(() => {});
    jest.spyOn(authFlow.callbackServer, 'waitForCallback').mockReturnValue(neverCallback);

    const authPromise = authFlow.authenticate(server(), store, mockFetch, opener);
    authPromise.catch(() => {});
    await expect(authPromise).rejects.toThrow('browser blocked');
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
    expect(mockTransportInstances).toHaveLength(1);
    expect(mockTransportInstances[0]!.close).toHaveBeenCalled();
  });

  it('closes a pending OAuth transport during shutdown', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    const started = await authFlow.startAuth(server(), store, mockFetch);
    const transport = mockTransportInstances[0]!;

    await authFlow.shutdown();

    expect(transport.close).toHaveBeenCalledTimes(1);
    await expect(authFlow.completeAuth('github', 'late-code', started.operationId)).rejects.toThrow(
      'No pending OAuth flow for server: github',
    );
  });

  it('keeps callback servers and transports isolated between flow instances', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });
    const otherFlow = new McpAuthFlow();
    const otherStore = new McpVaultAuthStore(new MemoryVaultAdapter() as never);

    try {
      const first = await authFlow.startAuth(server(), store, mockFetch);
      const second = await otherFlow.startAuth(server(), otherStore, mockFetch);
      const firstTransport = mockTransportInstances[0]!;
      const secondTransport = mockTransportInstances[1]!;

      expect(otherFlow.callbackServer.port).not.toBe(authFlow.callbackServer.port);

      await authFlow.shutdown();

      expect(firstTransport.close).toHaveBeenCalledTimes(1);
      expect(secondTransport.close).not.toHaveBeenCalled();
      await expect(
        otherFlow.completeAuth('github', 'second-code', second.operationId),
      ).resolves.toBe('authenticated');
      expect(secondTransport.finishAuth).toHaveBeenCalledWith('second-code');
      await expect(
        authFlow.completeAuth('github', 'first-code', first.operationId),
      ).rejects.toThrow('No pending OAuth flow');
    } finally {
      await otherFlow.shutdown();
    }
  });

  it('does not let a stale operation close a replacement transport', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });
    const { promise: openerPromise, reject: rejectOpener } = promiseWithResolvers<void>();
    const { promise: openerCalled, resolve: resolveOpenerCalled } = promiseWithResolvers<void>();
    const opener: ExternalOpener = {
      openExternalUrl: jest.fn(() => {
        resolveOpenerCalled();
        return openerPromise;
      }),
    };

    const staleAuthentication = authFlow.authenticate(server(), store, mockFetch, opener);
    staleAuthentication.catch(() => {});
    await openerCalled;
    const staleTransport = mockTransportInstances[0]!;

    await authFlow.removeAuth('github', store);
    const replacement = await authFlow.startAuth(server(), store, mockFetch);
    const replacementTransport = mockTransportInstances[1]!;

    rejectOpener(new Error('stale opener failed'));
    await expect(staleAuthentication).rejects.toThrow('stale opener failed');

    expect(staleTransport.close).toHaveBeenCalledTimes(1);
    expect(replacementTransport.close).not.toHaveBeenCalled();
    await expect(
      authFlow.completeAuth('github', 'replacement-code', replacement.operationId),
    ).resolves.toBe('authenticated');
  });
});
