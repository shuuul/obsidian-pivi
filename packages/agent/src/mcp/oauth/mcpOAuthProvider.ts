import {
  McpOAuthAuthorizationRequiredError,
  type OAuthClientInformation,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  stepUpScope,
} from '@earendil-works/pi-mcp/oauth';

import type { McpOAuthConfig } from '../types';
import type { McpAuthEntryStore, StoredClientInfo, StoredTokens } from './mcpAuthEntryStore';

export const DEFAULT_OAUTH_CALLBACK_PORT = 19876;
export const OAUTH_CALLBACK_PATH = '/callback';

export function validateOAuthCallbackPort(port: number | undefined = DEFAULT_OAUTH_CALLBACK_PORT): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid OAuth callback port: ${String(port)}`);
  }
  return port;
}

/** No interactive sign-in is in progress, so the user must authenticate from Settings. */
class McpServerReauthenticationRequiredError extends McpOAuthAuthorizationRequiredError {
  constructor(serverName: string) {
    super();
    this.message = `Re-authentication required for MCP server: ${serverName}`;
  }
}

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly config: McpOAuthConfig,
    private readonly store: McpAuthEntryStore,
    private readonly callbacks: McpOAuthCallbacks,
    private readonly callbackPort: number,
  ) {}

  private get usesClientCredentials(): boolean {
    return this.config.grantType === 'client_credentials';
  }

  /** Unused by the client-credentials grant, which never redirects. */
  get redirectUrl(): string {
    return `http://localhost:${this.callbackPort}${OAUTH_CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    if (this.usesClientCredentials) {
      return {
        client_name: 'Pivi',
        redirect_uris: [],
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
      };
    }

    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'Pivi',
      client_uri: 'https://github.com/shuuul/obsidian-pivi',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      };
    }

    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (entry?.clientInfo) {
      if (entry.clientInfo.clientSecretExpiresAt
        && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
        return undefined;
      }
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret,
      };
    }

    return undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const clientInfo: StoredClientInfo = {
      clientId: info.client_id,
      clientSecret: info.client_secret,
      clientIdIssuedAt: info.client_id_issued_at,
      clientSecretExpiresAt: info.client_secret_expires_at,
    };
    await this.store.updateClientInfo(this.serverName, clientInfo, this.serverUrl);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.tokens) {
      return undefined;
    }

    return {
      access_token: entry.tokens.accessToken,
      token_type: 'Bearer',
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const storedTokens: StoredTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
      scope: tokens.scope,
    };
    await this.store.updateTokens(this.serverName, storedTokens, this.serverUrl);
  }

  /** Keep the scope an `insufficient_scope` challenge asked for, merged with the current grant. */
  async recordStepUpScope(challengedScope: string | undefined): Promise<void> {
    const scope = stepUpScope((await this.tokens())?.scope, challengedScope);
    if (scope) {
      await this.store.updateStepUpScope(this.serverName, scope, this.serverUrl);
    }
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.usesClientCredentials) {
      throw new Error('redirectToAuthorization is not used for client_credentials flow');
    }
    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.oauthState) {
      throw new McpServerReauthenticationRequiredError(this.serverName);
    }
    await this.callbacks.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.updateCodeVerifier(this.serverName, codeVerifier, this.serverUrl);
  }

  async codeVerifier(): Promise<string> {
    if (this.usesClientCredentials) {
      throw new Error('codeVerifier is not used for client_credentials flow');
    }
    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.codeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.serverName}`);
    }
    return entry.codeVerifier;
  }

  async saveState(state: string): Promise<void> {
    await this.store.updateOAuthState(this.serverName, state, this.serverUrl);
  }

  async state(): Promise<string> {
    if (this.usesClientCredentials) {
      throw new Error('state is not used for client_credentials flow');
    }
    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.oauthState) {
      throw new McpServerReauthenticationRequiredError(this.serverName);
    }
    return entry.oauthState;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    switch (scope) {
      case 'all':
        await this.store.removeEntry(this.serverName);
        break;
      case 'client':
        await this.store.clearClientInfo(this.serverName);
        break;
      case 'tokens':
        await this.store.clearTokens(this.serverName);
        break;
      case 'verifier':
        await this.store.clearCodeVerifier(this.serverName);
        break;
      default:
        break;
    }
  }
}
