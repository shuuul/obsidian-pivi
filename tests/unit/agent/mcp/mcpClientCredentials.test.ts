import type { OAuthClientProvider, OAuthTokens } from '@earendil-works/pi-mcp/oauth';
import {
  authorizeMcpClientCredentials,
  createClientCredentialsAuthProvider,
} from '@pivi/agent/mcp/oauth/mcpClientCredentials';

const SERVER_URL = 'https://mcp.example.com/mcp';
const ISSUER = 'https://auth.example.com';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createProvider(clientId = 'client-id'): OAuthClientProvider & { saved: OAuthTokens[] } {
  const saved: OAuthTokens[] = [];
  return {
    saved,
    redirectUrl: 'http://localhost/callback',
    clientMetadata: { client_name: 'Pivi', redirect_uris: [], grant_types: ['client_credentials'] },
    clientInformation: () => ({ client_id: clientId, client_secret: 'client-secret' }),
    tokens: () => saved.at(-1),
    saveTokens: (tokens) => {
      saved.push(tokens);
    },
    redirectToAuthorization: () => undefined,
    saveCodeVerifier: () => undefined,
    codeVerifier: () => '',
  };
}

function createFetch(tokenResponses: Array<() => Response>): jest.Mock {
  return jest.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/.well-known/oauth-protected-resource')) {
      return json({ resource: SERVER_URL, authorization_servers: [ISSUER] });
    }
    if (url.startsWith(`${ISSUER}/.well-known/`)) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        response_types_supported: ['code'],
      });
    }
    if (url === `${ISSUER}/token` && init?.method === 'POST') {
      const next = tokenResponses.shift();
      if (!next) throw new Error('unexpected token request');
      return next();
    }
    return new Response('not found', { status: 404 });
  });
}

describe('MCP client-credentials grant', () => {
  it('exchanges client credentials at the discovered token endpoint', async () => {
    const provider = createProvider();
    const fetch = createFetch([() => json({ access_token: 'machine-token', token_type: 'Bearer', expires_in: 60 })]);

    await authorizeMcpClientCredentials(provider, { serverUrl: SERVER_URL, scope: 'read', fetch });

    expect(provider.saved).toEqual([{ access_token: 'machine-token', token_type: 'Bearer', expires_in: 60 }]);
    const tokenCall = fetch.mock.calls.find(([url]) => String(url) === `${ISSUER}/token`);
    const body = new URLSearchParams(String(tokenCall?.[1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
      scope: 'read',
      resource: SERVER_URL,
    });
  });

  it('surfaces OAuth error responses', async () => {
    const fetch = createFetch([() => json({ error: 'invalid_client', error_description: 'bad secret' }, 401)]);

    await expect(
      authorizeMcpClientCredentials(createProvider(), { serverUrl: SERVER_URL, fetch }),
    ).rejects.toThrow('bad secret');
  });

  it('re-runs the grant after a 401 and skips it when another request already refreshed', async () => {
    const provider = createProvider();
    provider.saved.push({ access_token: 'stale', token_type: 'Bearer' });
    const fetch = createFetch([() => json({ access_token: 'fresh', token_type: 'Bearer' })]);
    const auth = createClientCredentialsAuthProvider(provider, undefined);
    const context = { response: new Response(null, { status: 401 }), serverUrl: new URL(SERVER_URL), fetch };

    await auth.onUnauthorized?.({ ...context, token: 'stale' });
    await expect(auth.token()).resolves.toBe('fresh');

    await auth.onUnauthorized?.({ ...context, token: 'stale' });
    expect(fetch.mock.calls.filter(([url]) => String(url) === `${ISSUER}/token`)).toHaveLength(1);
  });
});
