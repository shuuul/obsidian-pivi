import {
  listObsidianSecretIds,
  PIVI_PROVIDER_SECRET_PREFIX,
  stableProviderIdDigest,
} from './providerSecretStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const PI_AI_CREDENTIAL_KIND = 'credential';
const PI_AI_CREDENTIAL_DIGEST_PREFIX = `${PIVI_PROVIDER_SECRET_PREFIX}-cp-cred`;

function directPiAiCredentialSecretId(providerId: string): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${PI_AI_CREDENTIAL_KIND}`;
}

function digestPiAiCredentialSecretId(providerId: string): string {
  return `${PI_AI_CREDENTIAL_DIGEST_PREFIX}-${stableProviderIdDigest(providerId)}`;
}

export function listPiAiCredentialSecretIds(providerId: string): readonly string[] {
  return listObsidianSecretIds(
    directPiAiCredentialSecretId(providerId),
    digestPiAiCredentialSecretId(providerId),
  );
}

export function getPiAiCredentialSecretId(providerId: string): string {
  return listPiAiCredentialSecretIds(providerId)[0]!;
}

export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';
export const XAI_PROVIDER_ID = 'xai';
export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const GROK_BUILD_PROVIDER_ID = 'grok-build';
export const CLAUDE_PROVIDER_ID = 'claude';
export const OPENROUTER_PROVIDER_ID = 'openrouter';
export const KIMI_CODING_PROVIDER_ID = 'kimi-coding';

export const SUBSCRIPTION_OAUTH_PROVIDER_IDS = [
  GROK_BUILD_PROVIDER_ID,
  CLAUDE_PROVIDER_ID,
] as const;

export type SubscriptionOAuthProviderId = (typeof SUBSCRIPTION_OAUTH_PROVIDER_IDS)[number];

/** Built-in providers that accept legacy API keys but expose OAuth for new sign-in. */
export const DUAL_AUTH_OAUTH_PROVIDER_IDS = [
  OPENROUTER_PROVIDER_ID,
  KIMI_CODING_PROVIDER_ID,
] as const;

export type DualAuthOAuthProviderId = (typeof DUAL_AUTH_OAUTH_PROVIDER_IDS)[number];

export const INTERACTIVE_OAUTH_PROVIDER_IDS = [
  CODEX_OAUTH_PROVIDER_ID,
  ...SUBSCRIPTION_OAUTH_PROVIDER_IDS,
  ...DUAL_AUTH_OAUTH_PROVIDER_IDS,
] as const;

export type InteractiveOAuthProviderId = (typeof INTERACTIVE_OAUTH_PROVIDER_IDS)[number];

export function isSubscriptionOAuthProviderId(
  providerId: string,
): providerId is SubscriptionOAuthProviderId {
  return (SUBSCRIPTION_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function isDualAuthOAuthProviderId(providerId: string): providerId is DualAuthOAuthProviderId {
  return (DUAL_AUTH_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function isInteractiveOAuthProvider(providerId: string): providerId is InteractiveOAuthProviderId {
  return (INTERACTIVE_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

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
