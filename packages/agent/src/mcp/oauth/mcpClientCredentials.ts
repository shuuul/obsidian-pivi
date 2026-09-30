import type { AuthProvider, McpFetch } from '@earendil-works/pi-mcp';
import {
  discoverOAuthServerInfo,
  type OAuthClientProvider,
  OAuthError,
  type OAuthTokens,
  registerClient,
  selectResource,
} from '@earendil-works/pi-mcp/oauth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTokenResponse(value: unknown, status: number, text: string): OAuthTokens {
  // Servers may report OAuth errors with any status, so check the body before the status.
  if (isRecord(value) && typeof value.error === 'string') {
    throw new OAuthError(
      value.error,
      typeof value.error_description === 'string' ? value.error_description : value.error,
    );
  }
  if (status < 200 || status >= 300 || !isRecord(value) || typeof value.access_token !== 'string') {
    throw new OAuthError('server_error', `HTTP ${status}: ${text}`);
  }
  return {
    access_token: value.access_token,
    token_type: typeof value.token_type === 'string' ? value.token_type : 'Bearer',
    ...(typeof value.expires_in === 'number' ? { expires_in: value.expires_in } : {}),
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
  };
}

/**
 * OAuth client-credentials grant for machine-to-machine MCP servers. pi-mcp
 * implements only the authorization-code flow, so Pivi owns this grant:
 * discover the authorization server, register a client when none is
 * configured, then exchange client credentials for an access token.
 */
export async function authorizeMcpClientCredentials(
  provider: OAuthClientProvider,
  options: { serverUrl: string | URL; scope?: string; fetch: McpFetch },
): Promise<void> {
  const discovered = await discoverOAuthServerInfo(options.serverUrl, { fetch: options.fetch });
  const metadata = discovered.authorizationServerMetadata;
  const scope = options.scope ?? provider.clientMetadata.scope;

  let client = await provider.clientInformation();
  if (!client) {
    client = await registerClient(discovered.authorizationServerUrl, {
      metadata,
      clientMetadata: provider.clientMetadata,
      scope,
      fetch: options.fetch,
    });
    await provider.saveClientInformation?.(client);
  }

  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: client.client_id });
  if (client.client_secret) params.set('client_secret', client.client_secret);
  if (scope) params.set('scope', scope);
  const resource = selectResource(options.serverUrl, discovered.resourceMetadata);
  if (resource) params.set('resource', resource);

  const tokenEndpoint = metadata?.token_endpoint ?? new URL('/token', discovered.authorizationServerUrl).href;
  const response = await options.fetch(tokenEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  await provider.saveTokens(parseTokenResponse(body, response.status, text));
}

/** Transport auth for client-credentials servers: re-run the grant after a 401. */
export function createClientCredentialsAuthProvider(
  provider: OAuthClientProvider,
  scope: string | undefined,
): AuthProvider {
  let inFlight: Promise<void> | undefined;
  return {
    token: async () => (await provider.tokens())?.access_token,
    onUnauthorized: async (context) => {
      if (context.token !== undefined && !inFlight) {
        const current = (await provider.tokens())?.access_token;
        // Another request already replaced the rejected token; just retry.
        if (current !== undefined && current !== context.token) return;
      }
      inFlight ??= authorizeMcpClientCredentials(provider, {
        serverUrl: context.serverUrl,
        scope,
        fetch: context.fetch,
      }).finally(() => {
        inFlight = undefined;
      });
      await inFlight;
    },
  };
}
