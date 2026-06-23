import {
  auth as runSdkAuth,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { ManagedMcpServer, McpAuthStatus, McpOAuthConfig } from '../../../core/types';
import { getMcpServerUrl } from '../../../core/types';
import { nodeFetch } from '../../../utils/nodeFetch';
import {
  cancelPendingCallback,
  ensureCallbackServer,
  stopCallbackServer,
  waitForCallback,
} from './McpCallbackServer';
import { McpOAuthProvider } from './McpOAuthProvider';
import type { McpVaultAuthStore } from './McpVaultAuthStore';
import { openAuthUrl } from './openAuthUrl';

const pendingTransports = new Map<string, StreamableHTTPClientTransport>();
const pendingAuthentications = new Map<string, Promise<McpAuthStatus>>();

function generateState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractOAuthConfig(server: ManagedMcpServer): McpOAuthConfig {
  if (server.oauth === false) {
    return {};
  }
  if (server.oauth && typeof server.oauth === 'object') {
    return server.oauth;
  }
  return {};
}

export async function startAuth(
  server: ManagedMcpServer,
  store: McpVaultAuthStore,
): Promise<{ authorizationUrl: string }> {
  const serverName = server.name;
  const serverUrl = getMcpServerUrl(server.config);
  if (!serverUrl) {
    throw new Error(`MCP server "${serverName}" has no URL`);
  }

  const config = extractOAuthConfig(server);
  const storedAuth = await store.getAuthForUrl(serverName, serverUrl);
  if (storedAuth?.clientInfo && !storedAuth.tokens && !config.clientId) {
    await store.clearClientInfo(serverName);
    await store.clearCodeVerifier(serverName);
    await store.clearOAuthState(serverName);
  }

  if (config.grantType === 'client_credentials') {
    const authProvider = new McpOAuthProvider(serverName, serverUrl, config, store, {
      onRedirect: () => Promise.reject(new Error('Browser redirect is not used for client_credentials flow')),
    });
    const result = await runSdkAuth(authProvider, { serverUrl });
    if (result !== 'AUTHORIZED') {
      throw new UnauthorizedError('Failed to authorize');
    }
    return { authorizationUrl: '' };
  }

  await ensureCallbackServer({ strictPort: Boolean(config.clientId) });

  const oauthState = generateState();
  await store.updateOAuthState(serverName, oauthState, serverUrl);

  let capturedUrl: URL | undefined;
  const authProvider = new McpOAuthProvider(serverName, serverUrl, config, store, {
    onRedirect: (url) => {
      capturedUrl = url;
      return Promise.resolve();
    },
  });

  try {
    const result = await runSdkAuth(authProvider, { serverUrl });
    if (result === 'AUTHORIZED') {
      await store.clearOAuthState(serverName);
      return { authorizationUrl: '' };
    }
    if (!capturedUrl) {
      throw new UnauthorizedError('OAuth authorization URL was not provided');
    }
    pendingTransports.set(
      serverName,
      new StreamableHTTPClientTransport(new URL(serverUrl), {
        authProvider,
        fetch: nodeFetch,
      }),
    );
    return { authorizationUrl: capturedUrl.toString() };
  } catch (error) {
    await store.clearOAuthState(serverName);
    throw error;
  }
}

export async function completeAuth(serverName: string, authorizationCode: string): Promise<McpAuthStatus> {
  const transport = pendingTransports.get(serverName);
  if (!transport) {
    throw new Error(`No pending OAuth flow for server: ${serverName}`);
  }

  try {
    await transport.finishAuth(authorizationCode);
    return 'authenticated';
  } finally {
    pendingTransports.delete(serverName);
    await transport.close().catch(() => {});
  }
}

export async function authenticate(
  server: ManagedMcpServer,
  store: McpVaultAuthStore,
): Promise<McpAuthStatus> {
  const inFlight = pendingAuthentications.get(server.name);
  if (inFlight) {
    return inFlight;
  }

  const operation = (async (): Promise<McpAuthStatus> => {
    const { authorizationUrl } = await startAuth(server, store);

    if (!authorizationUrl) {
      return 'authenticated';
    }

    const oauthState = await store.getOAuthState(server.name);
    if (!oauthState) {
      throw new Error('OAuth state not found');
    }

    const callbackPromise = waitForCallback(oauthState);

    try {
      openAuthUrl(authorizationUrl);
      const code = await callbackPromise;

      const storedState = await store.getOAuthState(server.name);
      if (storedState !== oauthState) {
        await store.clearOAuthState(server.name);
        throw new Error('OAuth state mismatch');
      }
      await store.clearOAuthState(server.name);

      return await completeAuth(server.name, code);
    } catch (error) {
      cancelPendingCallback(oauthState);
      await store.clearOAuthState(server.name);
      const pendingTransport = pendingTransports.get(server.name);
      if (pendingTransport) {
        pendingTransports.delete(server.name);
        await pendingTransport.close().catch(() => {});
      }
      throw error;
    }
  })();

  pendingAuthentications.set(server.name, operation);

  try {
    return await operation;
  } finally {
    if (pendingAuthentications.get(server.name) === operation) {
      pendingAuthentications.delete(server.name);
    }
  }
}

export async function getAuthStatusForServer(
  serverName: string,
  store: McpVaultAuthStore,
): Promise<McpAuthStatus> {
  const hasTokens = await store.hasStoredTokens(serverName);
  if (!hasTokens) {
    return 'not_authenticated';
  }
  const expired = await store.isTokenExpired(serverName);
  return expired ? 'expired' : 'authenticated';
}

export async function removeAuth(serverName: string, store: McpVaultAuthStore): Promise<void> {
  const oauthState = await store.getOAuthState(serverName);
  if (oauthState) {
    cancelPendingCallback(oauthState);
  }
  const pendingTransport = pendingTransports.get(serverName);
  if (pendingTransport) {
    pendingTransports.delete(serverName);
    await pendingTransport.close().catch(() => {});
  }
  await store.removeEntry(serverName);
  await store.clearOAuthState(serverName);
}

export async function initializeOAuth(): Promise<void> {
  await ensureCallbackServer();
}

export async function shutdownOAuth(): Promise<void> {
  await stopCallbackServer();
}
