import { PIVI_PROVIDER_SECRET_PREFIX } from './providerSecretStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const PI_AI_CREDENTIAL_KIND = 'credential';

export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';

export interface ApiKeyProviderCredential {
  type: 'api_key';
  key: string;
}

export interface OAuthProviderCredential {
  type: 'oauth';
  access: string;
  refresh?: string;
  expires?: number;
}

export type ProviderCredential = ApiKeyProviderCredential | OAuthProviderCredential | { type: string };

export function getPiAiCredentialSecretId(providerId: string): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${PI_AI_CREDENTIAL_KIND}`;
}

export function parseProviderCredential(raw: string | null): ProviderCredential | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    if (parsed.type === 'api-key' && typeof parsed.key === 'string') {
      return { ...parsed, type: 'api_key' };
    }
    if (parsed.type === 'api_key' || parsed.type === 'oauth') {
      return parsed as ProviderCredential;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function serializeProviderCredential(credential: ProviderCredential): string {
  return JSON.stringify(credential);
}

export function credentialToApiKey(credential: ProviderCredential | undefined): string | undefined {
  if (!credential) {
    return undefined;
  }
  if ((credential.type === 'api_key' || credential.type === 'api-key')
    && 'key' in credential
    && typeof credential.key === 'string') {
    return credential.key;
  }
  if (isOAuthCredential(credential)) {
    if (credential.expires && credential.expires < Date.now()) {
      return undefined;
    }
    return credential.access;
  }
  return undefined;
}

export function isOAuthCredential(value: ProviderCredential | undefined): value is OAuthProviderCredential {
  return !!value && value.type === 'oauth' && typeof (value as { access?: unknown }).access === 'string';
}
