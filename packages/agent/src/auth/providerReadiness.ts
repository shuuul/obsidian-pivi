import { parseEnvironmentVariables } from '../settings/environmentText';
import type { ProviderCredential } from './piProviderCredentials';
import {
  isInteractiveOAuthProvider,
  isOAuthCredential,
  isSubscriptionOAuthProviderId,
} from './piProviderCredentials';
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
  interactiveOAuthConnected?: boolean;
  modelCount?: number;
  now?: number;
  /** Keyless local/custom providers can be ready without a stored credential. */
  allowKeyless?: boolean;
}

function hasEnvironmentCredential(providerId: string, environmentVariables: string): boolean {
  const env = parseEnvironmentVariables(environmentVariables);
  const names = getProviderEnvVarNames(providerId);
  return !!env[names.apiKeyVar]?.trim()
    || !!(names.oauthVar && env[names.oauthVar]?.trim())
    || !!(names.authTokenVar && env[names.authTokenVar]?.trim());
}

/**
 * `expires` is the access-token deadline, not the session's. pi-ai refreshes
 * an expired access token on the next request whenever a refresh token is
 * stored, so only a credential that cannot refresh is actually expired.
 * Short-lived access tokens (Sign in with ChatGPT) otherwise read as expired
 * minutes after a successful login.
 */
function isExpiredOAuth(credential: ProviderCredential | undefined, now: number): boolean {
  if (!isOAuthCredential(credential)) return false;
  if (typeof credential.refresh === 'string' && credential.refresh.trim()) return false;
  return typeof credential.expires === 'number' && credential.expires <= now;
}

export function deriveProviderReadinessStatus(
  options: DeriveProviderReadinessOptions,
): ProviderReadinessStatus {
  const {
    providerId,
    piSettings,
    credential,
    interactiveOAuthConnected,
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

  const hasCredential = isSubscriptionOAuthProviderId(providerId)
    ? !!interactiveOAuthConnected || isOAuthCredential(credential)
    : isInteractiveOAuthProvider(providerId)
      ? !!interactiveOAuthConnected || !!credential || hasEnvironmentCredential(providerId, piSettings.environmentVariables)
      : !!credential || hasEnvironmentCredential(providerId, piSettings.environmentVariables);

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
