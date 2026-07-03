import { get } from 'http';

import type { ExternalOpener } from '@pivi/pivi-agent-core/ports';
import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';
import {
  authenticate,
  completeAuth,
  removeAuth,
  startAuth,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpAuthFlow';
import * as mcpCallbackServer from '@pivi/pivi-agent-core/mcp/oauth/mcpCallbackServer';
import { stopCallbackServer } from '@pivi/pivi-agent-core/mcp/oauth/mcpCallbackServer';
import {
  getOAuthCallbackPort,
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

function requestCallback(state: string, code: string): Promise<void> {
  const { promise, resolve, reject } = promiseWithResolvers<void>();
  const req = get(
    `http://localhost:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}?state=${state}&code=${code}`,
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

  beforeEach(() => {
    jest.restoreAllMocks();
    store = new McpVaultAuthStore(new MemoryVaultAdapter() as never);
    mockFetch = jest.fn() as unknown as McpTransportFetch;
    mockRunSdkAuth.mockReset();
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockResolvedValue(undefined);
    mockTransportInstances.length = 0;
  });

  afterEach(async () => {
    await stopCallbackServer();
    await removeAuth('github', store).catch(() => {});
  });

  it('starts an authorization-code flow and completes the pending transport', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    await expect(startAuth(server(), store, mockFetch)).resolves.toEqual({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
    expect(mockTransportInstances).toHaveLength(1);
    expect(mockTransportInstances[0].options.fetch).toBe(mockFetch);

    await expect(completeAuth('github', 'callback-code')).resolves.toBe('authenticated');
    expect(mockTransportInstances[0].finishAuth).toHaveBeenCalledWith('callback-code');
    expect(mockTransportInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it('does not reuse stored client information when the server URL changes', async () => {
    await store.updateClientInfo('github', { clientId: 'old-client' }, 'https://old.example.com');
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await expect(provider.clientInformation()).resolves.toBeUndefined();
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    await expect(startAuth(server('https://new.example.com'), store, mockFetch)).resolves.toEqual({
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

    const authPromise = authenticate(server(), store, mockFetch, opener);
    await openerCalled;

    const oauthState = await store.getOAuthState('github');
    expect(oauthState).toBeTruthy();
    await requestCallback(oauthState!, 'callback-code');

    await expect(authPromise).resolves.toBe('authenticated');
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(opener.openExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(mockTransportInstances[0].options.fetch).toBe(mockFetch);
    expect(mockTransportInstances[0].finishAuth).toHaveBeenCalledWith('callback-code');
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
    jest.spyOn(mcpCallbackServer, 'waitForCallback').mockReturnValue(neverCallback);

    const authPromise = authenticate(server(), store, mockFetch, opener);
    authPromise.catch(() => {});
    await expect(authPromise).rejects.toThrow('browser blocked');
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
    expect(mockTransportInstances[0].close).toHaveBeenCalled();
  });
});