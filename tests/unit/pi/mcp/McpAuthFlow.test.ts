import { get } from 'http';

import type { ManagedMcpServer } from '../../../../src/core/types';
import {
  authenticate,
  completeAuth,
  removeAuth,
  startAuth,
} from '../../../../src/pi/mcp/oauth/McpAuthFlow';
import { stopCallbackServer } from '../../../../src/pi/mcp/oauth/McpCallbackServer';
import {
  getOAuthCallbackPort,
  OAUTH_CALLBACK_PATH,
} from '../../../../src/pi/mcp/oauth/McpOAuthProvider';
import { McpVaultAuthStore } from '../../../../src/pi/mcp/oauth/McpVaultAuthStore';

const mockRunSdkAuth = jest.fn();
const mockOpenAuthUrl = jest.fn();
const mockTransportInstances: Array<{
  close: jest.Mock;
  finishAuth: jest.Mock;
  options: unknown;
  url: URL;
}> = [];

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: (...args: unknown[]) => mockRunSdkAuth(...args),
  UnauthorizedError: class MockUnauthorizedError extends Error {},
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockTransport {
    readonly close = jest.fn().mockResolvedValue(undefined);
    readonly finishAuth = jest.fn().mockResolvedValue(undefined);

    constructor(readonly url: URL, readonly options: unknown) {
      mockTransportInstances.push(this);
    }
  },
}));

jest.mock('../../../../src/pi/mcp/oauth/openAuthUrl', () => ({
  openAuthUrl: (url: string) => mockOpenAuthUrl(url),
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
  return new Promise((resolve, reject) => {
    const req = get(
      `http://localhost:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}?state=${state}&code=${code}`,
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
  });
}

describe('McpAuthFlow', () => {
  let store: McpVaultAuthStore;

  beforeEach(() => {
    store = new McpVaultAuthStore(new MemoryVaultAdapter() as never);
    mockRunSdkAuth.mockReset();
    mockOpenAuthUrl.mockReset();
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

    await expect(startAuth(server(), store)).resolves.toEqual({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
    expect(mockTransportInstances).toHaveLength(1);

    await expect(completeAuth('github', 'callback-code')).resolves.toBe('authenticated');
    expect(mockTransportInstances[0].finishAuth).toHaveBeenCalledWith('callback-code');
    expect(mockTransportInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it('opens the authorization URL, waits for callback, verifies state, and cleans up state', async () => {
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    const authPromise = authenticate(server(), store);
    while (!mockOpenAuthUrl.mock.calls.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const oauthState = await store.getOAuthState('github');
    expect(oauthState).toBeTruthy();
    await requestCallback(oauthState!, 'callback-code');

    await expect(authPromise).resolves.toBe('authenticated');
    expect(mockOpenAuthUrl).toHaveBeenCalledWith('https://issuer.example.com/authorize');
    expect(mockTransportInstances[0].finishAuth).toHaveBeenCalledWith('callback-code');
    await expect(store.getOAuthState('github')).resolves.toBeUndefined();
  });

  it('does not reuse stored client information when the server URL changes', async () => {
    await store.updateClientInfo('github', { clientId: 'old-client' }, 'https://old.example.com');
    mockRunSdkAuth.mockImplementation(async (provider) => {
      await expect(provider.clientInformation()).resolves.toBeUndefined();
      await provider.redirectToAuthorization(new URL('https://issuer.example.com/authorize'));
      return 'REDIRECT';
    });

    await expect(startAuth(server('https://new.example.com'), store)).resolves.toEqual({
      authorizationUrl: 'https://issuer.example.com/authorize',
    });
  });
});
