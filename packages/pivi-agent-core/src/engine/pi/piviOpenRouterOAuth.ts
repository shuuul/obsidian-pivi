/**
 * Obsidian-safe OpenRouter OAuth PKCE flow.
 *
 * Mirrors earendil-works/pi packages/ai/src/auth/oauth/openrouter.ts, but routes
 * token exchange through the injected provider fetch used by the bundled fetch shim.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

import type { ProviderOAuthFetch } from './piviXaiOAuthDeviceFlow';

const OPENROUTER_OAUTH_NAME = 'OpenRouter OAuth';
const OPENROUTER_OAUTH_LOGIN_LABEL = 'Sign in with OpenRouter';

const AUTHORIZE_URL = 'https://openrouter.ai/auth';
const TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;
const CODE_CHALLENGE_METHOD = 'S256';

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

export function resolveOpenRouterOAuthCallbackHost(): string {
  const override = typeof process !== 'undefined' ? process.env.PI_OAUTH_CALLBACK_HOST?.trim() : '';
  return override || '127.0.0.1';
}

function oauthSuccessHtml(message: string): string {
  return `<!doctype html><html><body><p>${message}</p></body></html>`;
}

function oauthErrorHtml(heading: string, details?: string): string {
  return `<!doctype html><html><body><h1>${heading}</h1>${details ? `<p>${details}</p>` : ''}</body></html>`;
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(html);
}

function errorDetail(body: Record<string, unknown>): string | undefined {
  if (typeof body.error_description === 'string') {
    return body.error_description;
  }
  if (typeof body.message === 'string') {
    return body.message;
  }
  if (typeof body.error === 'string') {
    return body.error;
  }
  const nested = body.error;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return undefined;
}

async function exchangeAuthorizationCode(
  request: ProviderOAuthFetch,
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  if (signal?.aborted) {
    throw new Error('Login cancelled');
  }

  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort(signal?.reason);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = window.setTimeout(
    () => controller.abort(new Error('OpenRouter OAuth token exchange timed out')),
    TOKEN_EXCHANGE_TIMEOUT_MS,
  );

  let response: Response;
  let body: Record<string, unknown> = {};
  try {
    response = await request(TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: CODE_CHALLENGE_METHOD,
      }),
      signal: controller.signal,
    });
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      if (response.ok) {
        throw new Error('OpenRouter OAuth returned invalid JSON');
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Login cancelled');
    }
    if (controller.signal.aborted) {
      throw new Error('OpenRouter OAuth token exchange timed out');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    const detail = errorDetail(body);
    throw new Error(
      `OpenRouter OAuth key exchange failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  if (typeof body.key !== 'string' || body.key.length === 0) {
    throw new Error('OpenRouter OAuth response carries no "key"');
  }

  return {
    type: 'oauth',
    access: body.key,
    refresh: '',
    expires: Number.MAX_SAFE_INTEGER,
  };
}

interface CallbackServerHandle {
  callbackUrl: string;
  credential: Promise<OAuthCredential>;
  close: () => void;
}

async function startCallbackServer(
  callbackPath: string,
  verifier: string,
  request: ProviderOAuthFetch,
  signal?: AbortSignal,
): Promise<CallbackServerHandle> {
  if (signal?.aborted) {
    throw new Error('Login cancelled');
  }

  const callbackHost = resolveOpenRouterOAuthCallbackHost();
  let resolveCredential: (credential: OAuthCredential) => void = () => {};
  let rejectCredential: (error: Error) => void = () => {};
  const credential = new Promise<OAuthCredential>((resolve, reject) => {
    resolveCredential = resolve;
    rejectCredential = reject;
  });

  let server: Server;
  let claimed = false;
  let settled = false;
  let timeout: number | undefined;
  let onAbort: (() => void) | undefined;

  const finish = (result: { credential: OAuthCredential } | { error: Error }): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort);
    }
    server.close();
    if ('credential' in result) {
      resolveCredential(result.credential);
    } else {
      rejectCredential(result.error);
    }
  };

  const handleRequest = (incoming: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const requestUrl = new URL(incoming.url ?? '/', `http://${callbackHost}`);
      if (incoming.method !== 'GET' || requestUrl.pathname !== callbackPath) {
        sendHtml(response, 404, oauthErrorHtml('OAuth callback route not found.'));
        return;
      }
      if (claimed || settled) {
        sendHtml(response, 409, oauthErrorHtml('This OAuth callback has already been used.'));
        return;
      }

      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        const description = requestUrl.searchParams.get('error_description') ?? oauthError;
        sendHtml(response, 400, oauthErrorHtml('OpenRouter authorization was denied.', description));
        finish({ error: new Error(`OpenRouter authorization failed: ${description}`) });
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        sendHtml(response, 400, oauthErrorHtml('OpenRouter returned no authorization code.'));
        return;
      }

      claimed = true;
      try {
        const result = await exchangeAuthorizationCode(request, code, verifier, signal);
        sendHtml(response, 200, oauthSuccessHtml('Signed in to OpenRouter. You may now close this page.'));
        finish({ credential: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown token exchange error';
        sendHtml(response, 502, oauthErrorHtml('OpenRouter key exchange failed.', message));
        finish({ error: error instanceof Error ? error : new Error(message) });
      }
    })();
  };

  server = createServer((incoming, response) => {
    handleRequest(incoming, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, callbackHost, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  server.on('error', (error: Error) => finish({ error }));

  onAbort = () => finish({ error: new Error('Login cancelled') });
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    signal.removeEventListener('abort', onAbort);
    server.close();
    throw new Error('Login cancelled');
  }

  timeout = window.setTimeout(
    () => finish({ error: new Error('OpenRouter OAuth login timed out') }),
    LOGIN_TIMEOUT_MS,
  );

  const address = server.address();
  if (!address || typeof address === 'string') {
    finish({ error: new Error('Could not determine the OpenRouter OAuth callback port') });
    throw new Error('Could not determine the OpenRouter OAuth callback port');
  }

  return {
    callbackUrl: `http://${callbackHost}:${address.port}${callbackPath}`,
    credential,
    close: () => finish({ error: new Error('Login cancelled') }),
  };
}

async function loginOpenRouter(
  request: ProviderOAuthFetch,
  interaction: AuthInteraction,
): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePkce();
  const callbackPath = `/oauth/callback/${crypto.randomUUID()}`;
  const callback = await startCallbackServer(callbackPath, verifier, request, interaction.signal);

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    callback_url: callback.callbackUrl,
    code_challenge: challenge,
    code_challenge_method: CODE_CHALLENGE_METHOD,
  }).toString();

  interaction.notify({
    type: 'progress',
    message: `Listening for OpenRouter OAuth callback on ${callback.callbackUrl}`,
  });
  interaction.notify({
    type: 'auth_url',
    url: authorizeUrl.toString(),
    instructions: 'Complete sign-in in your browser.',
  });

  try {
    return await callback.credential;
  } finally {
    callback.close();
  }
}

/** OpenRouter OAuth with localhost callback host and injected provider fetch. */
export function createPiviOpenRouterOAuth(request: ProviderOAuthFetch): OAuthAuth {
  return {
    name: OPENROUTER_OAUTH_NAME,
    loginLabel: OPENROUTER_OAUTH_LOGIN_LABEL,
    login: interaction => loginOpenRouter(request, interaction),
    refresh: async credential => credential,
    toAuth: async credential => ({ apiKey: credential.access }),
  };
}
