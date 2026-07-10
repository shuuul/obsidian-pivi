import { parseEnvironmentVariables } from '../foundation/settingsEnv';
import type { ProviderCredential } from './piProviderCredentials';
import { CODEX_OAUTH_PROVIDER_ID } from './piProviderCredentials';
import { getProviderEnvVarNames } from './providerEnvVars';
import { isProviderDisabled } from './providerSecretStorage';

export type ProviderReadinessStatusKind =
  | 'ready'
  | 'missing-credential'
  | 'oauth-expired'
  | 'disabled'
  | 'unavailable';

export interface ProviderReadinessStatus {
  kind: ProviderReadinessStatusKind;
  label: string;
  description: string;
}

export interface DeriveProviderReadinessOptions {
  providerId: string;
  piSettings: {
    disabledProviders: readonly string[];
    environmentVariables: string;
  };
  credential?: ProviderCredential;
  codexConnected?: boolean;
  modelCount?: number;
  now?: number;
  /** Keyless local/custom providers can be ready without a stored credential. */
  allowKeyless?: boolean;
}

function hasEnvironmentCredential(providerId: string, environmentVariables: string): boolean {
  const env = parseEnvironmentVariables(environmentVariables);
  const names = getProviderEnvVarNames(providerId);
  return !!env[names.apiKeyVar]?.trim() || !!(names.oauthVar && env[names.oauthVar]?.trim());
}

function isExpiredOAuth(credential: ProviderCredential | undefined, now: number): boolean {
  return credential?.type === 'oauth'
    && 'expires' in credential
    && typeof credential.expires === 'number'
    && credential.expires <= now;
}

export function deriveProviderReadinessStatus(
  options: DeriveProviderReadinessOptions,
): ProviderReadinessStatus {
  const {
    providerId,
    piSettings,
    credential,
    codexConnected,
    modelCount,
    now = Date.now(),
    allowKeyless = false,
  } = options;

  if (isProviderDisabled(piSettings.disabledProviders, providerId)) {
    return {
      kind: 'disabled',
      label: 'Disabled',
      description: 'Saved credentials are kept, but this provider is hidden from model selection.',
    };
  }

  if (modelCount === 0) {
    return {
      kind: 'unavailable',
      label: 'Unavailable',
      description: 'No local pi-ai model metadata is available for this provider yet.',
    };
  }

  if (isExpiredOAuth(credential, now)) {
    return {
      kind: 'oauth-expired',
      label: 'OAuth expired',
      description: 'An OAuth credential exists, but its expiry is in the past. Reconnect before using this provider.',
    };
  }

  const hasCredential = providerId === CODEX_OAUTH_PROVIDER_ID
    ? !!codexConnected || !!credential
    : !!credential
      || hasEnvironmentCredential(providerId, piSettings.environmentVariables);

  if (!hasCredential && !allowKeyless) {
    return {
      kind: 'missing-credential',
      label: 'Missing credential',
      description: 'Add an API key or supported OAuth credential to use this provider.',
    };
  }

  return {
    kind: 'ready',
    label: 'Ready',
    description: allowKeyless && !hasCredential
      ? 'Local/custom endpoint is configured without a required API key.'
      : 'Credentials are present locally.',
  };
}
