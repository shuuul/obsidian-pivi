import { get } from 'http';
import { SecretStorage } from 'obsidian';

import type { ExternalOpener } from '@pivi/agent/ports';
import type { McpTransportFetch } from '@pivi/agent/mcp/ports';
import type { ManagedMcpServer } from '@pivi/agent/mcp/types';
import {
  McpAuthFlow,
} from '@pivi/agent/mcp/oauth/mcpAuthFlow';
import type { McpOAuthCallback } from '@pivi/agent/mcp/oauth/mcpCallbackServer';
import {
  OAUTH_CALLBACK_PATH,
} from '@pivi/agent/mcp/oauth/mcpOAuthProvider';
import { McpSecretAuthStore } from '@pivi/agent/mcp/oauth/mcpSecretAuthStore';

const mockAuthorizeMcp = jest.fn();
const mockOpenExternalUrl = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+
  return Promise.withResolvers<T>();
}

jest.mock('@earendil-works/pi-mcp/oauth', () => ({
  ...jest.requireActual('@earendil-works/pi-mcp/oauth'),
  authorizeMcp: (...args: unknown[]) => mockAuthorizeMcp(...args),
}));

/** Redirect on the first call, then accept the callback code. */
async function redirectThenAuthorize(
  provider: { redirectToAuthorization(url: URL): Promise<void> },
  options: { authorizationCode?: string },
): Promise<string> {
  if (options.authorizationCode) {
    return 'AUTHORIZED';
  }
  await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
  return 'REDIRECT';
}

function codeExchanges(): unknown[] {
  return mockAuthorizeMcp.mock.calls
    .map(([, options]) => (options as { authorizationCode?: string }).authorizationCode)
    .filter((code) => code !== undefined);
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

function requestCallback(port: number, state: string, code: string, iss?: string): Promise<void> {
  const { promise, resolve, reject } = promiseWithResolvers<void>();
  const issQuery = iss ? `&iss=${encodeURIComponent(iss)}` : '';
  const req = get(
    `http://localhost:${port}${OAUTH_CALLBACK_PATH}?state=${state}&code=${code}${issQuery}`,
    (res) => {
      res.resume();
      res.on('end', resolve);
    },
  );
  req.on('error', reject);
  return promise;
}

describe('McpAuthFlow', () => {
  let store: McpSecretAuthStore;
  let mockFetch: McpTransportFetch;
  let authFlow: McpAuthFlow;

  beforeEach(() => {
    jest.restoreAllMocks();
    store = new McpSecretAuthStore(new SecretStorage());
    mockFetch = jest.fn();
    mockAuthorizeMcp.mockReset();
    mockAuthorizeMcp.mockImplementation(redirectThenAuthorize);
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockResolvedValue(undefined);
    authFlow = new McpAuthFlow();
  });

  afterEach(async () => {
    await authFlow.shutdown();
    await authFlow.removeAuth('github', store).catch(() => {});
  });

  it('starts an authorization-code flow and exchanges the callback code', async () => {

    const started = await authFlow.startAuth(server(), store, mockFetch);
    expect(started).toMatchObject({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
    expect(mockAuthorizeMcp.mock.calls[0]?.[1]).toMatchObject({
      serverUrl: 'https://mcp.example.com',
      fetch: mockFetch,
    });

    await expect(
      authFlow.completeAuth('github', { code: 'callback-code' }, started.operationId),
    ).resolves.toBe('authenticated');
    expect(mockAuthorizeMcp.mock.calls[1]?.[1]).toMatchObject({
      serverUrl: 'https://mcp.example.com',
      authorizationCode: 'callback-code',
      fetch: mockFetch,
    });
    await expect(
      authFlow.completeAuth('github', { code: 'callback-code' }, started.operationId),
    ).rejects.toThrow('No pending OAuth flow');
  });

  it('does not reuse stored client information when the server URL changes', async () => {
    await store.updateClientInfo('github', { clientId: 'old-client' }, 'https://old.example.com');
    mockAuthorizeMcp.mockImplementation(async (provider) => {
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

    const authPromise = authFlow.authenticate(server(), store, mockFetch, opener);
    await openerCalled;

    const oauthState = await store.getOAuthState('github');
    expect(oauthState).toBeTruthy();
    await requestCallback(authFlow.callbackServer.port, oauthState!, 'callback-code');

    await expect(authPromise).resolves.toBe('authenticated');
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(opener.openExternalUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(codeExchanges()).toEqual(['callback-code']);
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
  });

  it('forwards the RFC 9207 iss parameter from the callback to the code exchange', async () => {
    const { promise: openerCalled, resolve: resolveOpenerCalled } = promiseWithResolvers<void>();
    const opener: ExternalOpener = {
      openExternalUrl: jest.fn(async () => {
        resolveOpenerCalled();
      }),
    };

    const authPromise = authFlow.authenticate(server(), store, mockFetch, opener);
    await openerCalled;
    const oauthState = await store.getOAuthState('github');
    await requestCallback(authFlow.callbackServer.port, oauthState!, 'callback-code', 'https://issuer.example.com');

    await expect(authPromise).resolves.toBe('authenticated');
    expect(mockAuthorizeMcp.mock.calls[1]?.[1]).toMatchObject({
      authorizationCode: 'callback-code',
      iss: 'https://issuer.example.com',
    });
  });

  it('omits iss from the code exchange when the authorization response has none', async () => {
    const started = await authFlow.startAuth(server(), store, mockFetch);

    await expect(
      authFlow.completeAuth('github', { code: 'plain-code' }, started.operationId),
    ).resolves.toBe('authenticated');
    expect(mockAuthorizeMcp.mock.calls[1]?.[1]).not.toHaveProperty('iss');
  });

  it('cleans up OAuth state when the injected opener rejects', async () => {
    const opener: ExternalOpener = {
      openExternalUrl: jest.fn().mockRejectedValue(new Error('browser blocked')),
    };

    const { promise: neverCallback } = promiseWithResolvers<McpOAuthCallback>();
    neverCallback.catch(() => {});
    jest.spyOn(authFlow.callbackServer, 'waitForCallback').mockReturnValue(neverCallback);

    const authPromise = authFlow.authenticate(server(), store, mockFetch, opener);
    authPromise.catch(() => {});
    await expect(authPromise).rejects.toThrow('browser blocked');
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
    expect(codeExchanges()).toEqual([]);
  });

  it('drops a pending authorization during shutdown', async () => {

    const started = await authFlow.startAuth(server(), store, mockFetch);

    await authFlow.shutdown();

    await expect(authFlow.completeAuth('github', { code: 'late-code' }, started.operationId)).rejects.toThrow(
      'No pending OAuth flow for server: github',
    );
  });

  it('keeps callback servers and pending authorizations isolated between flow instances', async () => {
    const otherFlow = new McpAuthFlow();
    const otherStore = new McpSecretAuthStore(new SecretStorage());

    try {
      const first = await authFlow.startAuth(server(), store, mockFetch);
      const second = await otherFlow.startAuth(server(), otherStore, mockFetch);
      expect(otherFlow.callbackServer.port).not.toBe(authFlow.callbackServer.port);

      await authFlow.shutdown();

      await expect(
        otherFlow.completeAuth('github', { code: 'second-code' }, second.operationId),
      ).resolves.toBe('authenticated');
      expect(codeExchanges()).toEqual(['second-code']);
      await expect(
        authFlow.completeAuth('github', { code: 'first-code' }, first.operationId),
      ).rejects.toThrow('No pending OAuth flow');
    } finally {
      await otherFlow.shutdown();
    }
  });

  it('does not let a stale operation drop a replacement authorization', async () => {
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

    await authFlow.removeAuth('github', store);
    const replacement = await authFlow.startAuth(server(), store, mockFetch);

    rejectOpener(new Error('stale opener failed'));
    await expect(staleAuthentication).rejects.toThrow('stale opener failed');

    await expect(
      authFlow.completeAuth('github', { code: 'replacement-code' }, replacement.operationId),
    ).resolves.toBe('authenticated');
  });
});
