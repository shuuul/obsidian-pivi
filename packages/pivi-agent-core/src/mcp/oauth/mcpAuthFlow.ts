import {
  auth as runSdkAuth,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ExternalOpener } from '@pivi/pivi-agent-core/ports';

import type { McpTransportFetch } from '../ports';
import type { ManagedMcpServer, McpAuthStatus, McpOAuthConfig } from '../types';
import { getMcpServerUrl } from '../types';
import { McpCallbackServer } from './mcpCallbackServer';
import { McpOAuthProvider } from './mcpOAuthProvider';
import type { McpVaultAuthStore } from './mcpVaultAuthStore';
import { openAuthUrl } from './openAuthUrl';

type OperationId = symbol;

interface PendingTransport {
  operationId: OperationId;
  transport: StreamableHTTPClientTransport;
}

interface PendingAuthentication {
  operationId: OperationId;
  promise: Promise<McpAuthStatus>;
}

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

export interface StartedMcpAuth {
  authorizationUrl: string;
  operationId: OperationId;
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

export class McpAuthFlow {
  private readonly pendingTransports = new Map<string, PendingTransport>();
  private readonly pendingAuthentications = new Map<string, PendingAuthentication>();
  private lifecycleGeneration = 0;
  readonly callbackServer: McpCallbackServer;

  constructor(callbackPort?: number) {
    this.callbackServer = new McpCallbackServer(callbackPort);
  }

  private assertActive(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw new Error('OAuth flow cancelled during shutdown');
    }
  }

  async startAuth(
    server: ManagedMcpServer,
    store: McpVaultAuthStore,
    fetch: McpTransportFetch,
    operationId: OperationId = Symbol(server.name),
  ): Promise<StartedMcpAuth> {
    const lifecycleGeneration = this.lifecycleGeneration;
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
      const authProvider = new McpOAuthProvider(
        serverName,
        serverUrl,
        config,
        store,
        {
          onRedirect: () => Promise.reject(
            new Error('Browser redirect is not used for client_credentials flow'),
          ),
        },
        this.callbackServer.port,
      );
      const result = await runSdkAuth(authProvider, { serverUrl });
      this.assertActive(lifecycleGeneration);
      if (result !== 'AUTHORIZED') {
        throw new UnauthorizedError('Failed to authorize');
      }
      return { authorizationUrl: '', operationId };
    }

    await this.callbackServer.ensure({ strictPort: Boolean(config.clientId) });
    this.assertActive(lifecycleGeneration);

    const oauthState = generateState();
    await store.updateOAuthState(serverName, oauthState, serverUrl);

    let capturedUrl: URL | undefined;
    const authProvider = new McpOAuthProvider(
      serverName,
      serverUrl,
      config,
      store,
      {
        onRedirect: (url) => {
          capturedUrl = url;
          return Promise.resolve();
        },
      },
      this.callbackServer.port,
    );

    try {
      const result = await runSdkAuth(authProvider, { serverUrl });
      this.assertActive(lifecycleGeneration);
      if (result === 'AUTHORIZED') {
        await this.clearMatchingOAuthState(serverName, oauthState, store);
        return { authorizationUrl: '', operationId };
      }
      if (!capturedUrl) {
        throw new UnauthorizedError('OAuth authorization URL was not provided');
      }
      this.pendingTransports.set(
        serverName,
        {
          operationId,
          transport: new StreamableHTTPClientTransport(new URL(serverUrl), {
            authProvider,
            fetch,
          }),
        },
      );
      return { authorizationUrl: capturedUrl.toString(), operationId };
    } catch (error) {
      await this.clearMatchingOAuthState(serverName, oauthState, store);
      throw error;
    }
  }

  async completeAuth(
    serverName: string,
    authorizationCode: string,
    operationId: OperationId,
  ): Promise<McpAuthStatus> {
    const pending = this.pendingTransports.get(serverName);
    if (!pending || pending.operationId !== operationId) {
      throw new Error(`No pending OAuth flow for server: ${serverName}`);
    }

    try {
      await pending.transport.finishAuth(authorizationCode);
      return 'authenticated';
    } finally {
      if (this.pendingTransports.get(serverName) === pending) {
        this.pendingTransports.delete(serverName);
      }
      await pending.transport.close().catch(() => {});
    }
  }

  async authenticate(
    server: ManagedMcpServer,
    store: McpVaultAuthStore,
    fetch: McpTransportFetch,
    externalOpener: ExternalOpener,
  ): Promise<McpAuthStatus> {
    const inFlight = this.pendingAuthentications.get(server.name);
    if (inFlight) {
      return inFlight.promise;
    }

    const operationId = Symbol(server.name);
    const operation = (async (): Promise<McpAuthStatus> => {
      const { authorizationUrl } = await this.startAuth(server, store, fetch, operationId);

      if (!authorizationUrl) {
        return 'authenticated';
      }

      const oauthState = await store.getOAuthState(server.name);
      if (!oauthState) {
        throw new Error('OAuth state not found');
      }

      const callbackPromise = this.callbackServer.waitForCallback(oauthState);
      callbackPromise.catch(() => {
        // The browser opener may still be pending when logout or dispose cancels the callback.
      });

      try {
        await openAuthUrl(authorizationUrl, externalOpener);
        const code = await callbackPromise;

        const storedState = await store.getOAuthState(server.name);
        if (storedState !== oauthState) {
          await this.clearMatchingOAuthState(server.name, oauthState, store);
          throw new Error('OAuth state mismatch');
        }
        await store.clearOAuthState(server.name);

        return await this.completeAuth(server.name, code, operationId);
      } catch (error) {
        this.callbackServer.cancelPendingCallback(oauthState);
        await this.clearMatchingOAuthState(server.name, oauthState, store);
        await this.closePendingTransport(server.name, operationId);
        throw error;
      }
    })();

    const pendingAuthentication = { operationId, promise: operation };
    this.pendingAuthentications.set(server.name, pendingAuthentication);

    try {
      return await operation;
    } finally {
      if (this.pendingAuthentications.get(server.name) === pendingAuthentication) {
        this.pendingAuthentications.delete(server.name);
      }
    }
  }

  async removeAuth(serverName: string, store: McpVaultAuthStore): Promise<void> {
    const oauthState = await store.getOAuthState(serverName);
    if (oauthState) {
      this.callbackServer.cancelPendingCallback(oauthState);
    }
    const pendingTransport = this.pendingTransports.get(serverName);
    if (pendingTransport) {
      this.pendingTransports.delete(serverName);
      await pendingTransport.transport.close().catch((error) => {
        console.warn(`Pivi: failed to close OAuth transport for ${serverName}`, error);
      });
    }
    await store.removeEntry(serverName);
    await store.clearOAuthState(serverName);
  }

  async shutdown(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.pendingAuthentications.clear();
    await this.callbackServer.stop();

    const transports = Array.from(this.pendingTransports.entries());
    this.pendingTransports.clear();
    await Promise.all(transports.map(async ([serverName, pending]) => {
      await pending.transport.close().catch((error) => {
        console.warn(`Pivi: failed to close OAuth transport for ${serverName}`, error);
      });
    }));
  }

  private async closePendingTransport(serverName: string, operationId: OperationId): Promise<void> {
    const pending = this.pendingTransports.get(serverName);
    if (!pending || pending.operationId !== operationId) {
      return;
    }
    this.pendingTransports.delete(serverName);
    await pending.transport.close().catch((closeError) => {
      console.warn(`Pivi: failed to close OAuth transport for ${serverName}`, closeError);
    });
  }

  private async clearMatchingOAuthState(
    serverName: string,
    oauthState: string,
    store: McpVaultAuthStore,
  ): Promise<void> {
    if (await store.getOAuthState(serverName) === oauthState) {
      await store.clearOAuthState(serverName);
    }
  }
}
