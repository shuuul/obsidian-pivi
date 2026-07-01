import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import type { McpOAuthConfig } from '../../../pi/types';
import type { McpVaultAuthStore, StoredClientInfo, StoredTokens } from './McpVaultAuthStore';

export const DEFAULT_OAUTH_CALLBACK_PORT = 19876;
export const OAUTH_CALLBACK_PATH = '/callback';

let configuredOAuthCallbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
let oauthCallbackPort = configuredOAuthCallbackPort;

if (typeof process !== 'undefined' && process.env.MCP_OAUTH_CALLBACK_PORT) {
  const parsedPort = Number.parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10);
  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    configuredOAuthCallbackPort = parsedPort;
    oauthCallbackPort = parsedPort;
  }
}

export function getConfiguredOAuthCallbackPort(): number {
  return configuredOAuthCallbackPort;
}

export function getOAuthCallbackPort(): number {
  return oauthCallbackPort;
}

export function setOAuthCallbackPort(port: number): void {
  oauthCallbackPort = port;
}

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly config: McpOAuthConfig,
    private readonly store: McpVaultAuthStore,
    private readonly callbacks: McpOAuthCallbacks,
  ) {}

  private get usesClientCredentials(): boolean {
    return this.config.grantType === 'client_credentials';
  }

  get redirectUrl(): string | undefined {
    if (this.usesClientCredentials) {
      return undefined;
    }
    return `http://localhost:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}`;
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

    const redirectUrl = this.redirectUrl;
    if (!redirectUrl) {
      throw new Error('redirectUrl is required for authorization_code flow');
    }

    return {
      redirect_uris: [redirectUrl],
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

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
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

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.usesClientCredentials) {
      throw new Error('redirectToAuthorization is not used for client_credentials flow');
    }
    const entry = await this.store.getAuthForUrl(this.serverName, this.serverUrl);
    if (!entry?.oauthState) {
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`,
      );
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
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`,
      );
    }
    return entry.oauthState;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens'): Promise<void> {
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
      default:
        break;
    }
  }

  prepareTokenRequest(scope?: string): URLSearchParams | undefined {
    if (!this.usesClientCredentials) {
      return undefined;
    }
    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    const requestedScope = scope ?? this.config.scope;
    if (requestedScope) {
      params.set('scope', requestedScope);
    }
    return params;
  }
}
