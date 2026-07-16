/**
 * xAI OAuth device-code flow with CLIProxyAPI verification URL selection.
 */
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { pollOAuthDeviceCodeFlow } from '@earendil-works/pi-ai/dist/auth/oauth/device-code.js';
import { xaiOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/xai.js';

import { selectDeviceVerificationUri } from './deviceVerificationUri';

const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const XAI_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

export type ProviderOAuthFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
}

function positiveNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
}

function validateVerificationUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Untrusted verification URI in xAI OAuth response');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Untrusted verification URI in xAI OAuth response');
  }
  return url.href;
}

function optionalVerificationUri(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  return validateVerificationUri(raw);
}

async function postForm(
  request: ProviderOAuthFetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Login cancelled');
    }
    throw error;
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await response.json() as unknown;
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    if (signal?.aborted) {
      throw new Error('Login cancelled');
    }
    throw new Error(`xAI OAuth returned invalid JSON (HTTP ${response.status})`);
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function requestFailure(action: string, response: { status: number; body: Record<string, unknown> }): Error {
  const error = typeof response.body.error === 'string' ? response.body.error : undefined;
  const description = typeof response.body.error_description === 'string'
    ? response.body.error_description
    : undefined;
  const detail = [error, description].filter(Boolean).join(': ');
  return new Error(`xAI OAuth ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
}

function parseDeviceCode(body: Record<string, unknown>) {
  const interval = body.interval;
  const intervalSeconds = typeof interval === 'number' && Number.isFinite(interval) && interval > 0
    ? interval
    : undefined;
  const verificationUriComplete = optionalVerificationUri(body.verification_uri_complete);
  const verificationUri = validateVerificationUri(requiredString(body, 'verification_uri'));
  const browserVerificationUri = selectDeviceVerificationUri(verificationUriComplete, verificationUri);
  if (!browserVerificationUri) {
    throw new Error('Invalid xAI OAuth response: missing verification URI');
  }
  return {
    deviceCode: requiredString(body, 'device_code'),
    userCode: requiredString(body, 'user_code'),
    verificationUri: browserVerificationUri,
    intervalSeconds,
    expiresInSeconds: positiveNumber(body, 'expires_in'),
  };
}

function credentialsFromTokenResponse(body: Record<string, unknown>, previousRefreshToken?: string): OAuthCredential {
  const access = requiredString(body, 'access_token');
  const refresh = body.refresh_token === undefined && previousRefreshToken
    ? previousRefreshToken
    : requiredString(body, 'refresh_token');
  const expiresInSeconds = body.expires_in === undefined
    ? DEFAULT_TOKEN_LIFETIME_SECONDS
    : positiveNumber(body, 'expires_in');
  return {
    type: 'oauth' as const,
    access,
    refresh,
    expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
  };
}

async function requestDeviceCode(request: ProviderOAuthFetch, signal?: AbortSignal) {
  const response = await postForm(request, XAI_DEVICE_CODE_URL, {
    client_id: XAI_CLIENT_ID,
    scope: XAI_SCOPE,
    referrer: 'pi',
  }, signal);
  if (!response.ok) {
    throw requestFailure('device authorization', response);
  }
  return parseDeviceCode(response.body);
}

async function pollForTokens(
  request: ProviderOAuthFetch,
  device: ReturnType<typeof parseDeviceCode>,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  return pollOAuthDeviceCodeFlow<OAuthCredential>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const response = await postForm(request, XAI_TOKEN_URL, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: XAI_CLIENT_ID,
        device_code: device.deviceCode,
      }, signal);
      if (response.ok) {
        return { status: 'complete' as const, value: credentialsFromTokenResponse(response.body) };
      }
      const error = response.body.error;
      if (error === 'authorization_pending') {
        return { status: 'pending' as const };
      }
      if (error === 'slow_down') {
        const interval = response.body.interval;
        return {
          status: 'slow_down' as const,
          intervalSeconds: typeof interval === 'number' ? interval : undefined,
        };
      }
      if (error === 'access_denied' || error === 'authorization_denied') {
        return { status: 'failed' as const, message: 'xAI device authorization was denied' };
      }
      if (error === 'expired_token') {
        return { status: 'failed' as const, message: 'xAI device code expired' };
      }
      return { status: 'failed' as const, message: requestFailure('device token polling', response).message };
    },
  });
}

async function loginXai(
  request: ProviderOAuthFetch,
  interaction: AuthInteraction,
): Promise<OAuthCredential> {
  const device = await requestDeviceCode(request, interaction.signal);
  interaction.notify({
    type: 'device_code',
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
  });
  return pollForTokens(request, device, interaction.signal);
}

/** xAI OAuth with CLIProxyAPI-style verification URL selection for device flows. */
export function createPiviXaiOAuth(request: ProviderOAuthFetch): OAuthAuth {
  return {
    name: xaiOAuth.name,
    login: interaction => loginXai(request, interaction),
    refresh: (credential, signal) => xaiOAuth.refresh(credential, signal),
    toAuth: credential => xaiOAuth.toAuth(credential),
  };
}
