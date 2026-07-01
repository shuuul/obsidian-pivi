import type { Credential } from '@earendil-works/pi-ai';

import { parseEnvironmentVariables } from '../../../pi/settings/env';
import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import { CODEX_OAUTH_PROVIDER_ID } from '../../auth/ProviderOAuthService';
import { isProviderDisabled } from '../../auth/ProviderSecretStorage';
import { isSupportedPiProviderId } from '../../piAiModels';
import type { PiAgentSettingsView } from '../../settings/agentSettings';

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
  piSettings: Pick<PiAgentSettingsView, 'disabledProviders' | 'environmentVariables'>;
  credential?: Credential;
  codexConnected?: boolean;
  modelCount?: number;
  now?: number;
}

function hasEnvironmentCredential(providerId: string, environmentVariables: string): boolean {
  const env = parseEnvironmentVariables(environmentVariables);
  const names = getProviderEnvVarNames(providerId);
  return !!env[names.apiKeyVar]?.trim() || !!(names.oauthVar && env[names.oauthVar]?.trim());
}

function isExpiredOAuth(credential: Credential | undefined, now: number): boolean {
  return credential?.type === 'oauth' && typeof credential.expires === 'number' && credential.expires <= now;
}

export function deriveProviderReadinessStatus(
  options: DeriveProviderReadinessOptions,
): ProviderReadinessStatus {
  const { providerId, piSettings, credential, codexConnected, modelCount, now = Date.now() } = options;

  if (isProviderDisabled(piSettings.disabledProviders, providerId)) {
    return {
      kind: 'disabled',
      label: 'Disabled',
      description: 'Saved credentials are kept, but this provider is hidden from model selection.',
    };
  }

  if (!isSupportedPiProviderId(providerId) || modelCount === 0) {
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

  if (!hasCredential) {
    return {
      kind: 'missing-credential',
      label: 'Missing credential',
      description: 'Add an API key or supported OAuth credential to use this provider.',
    };
  }

  return {
    kind: 'ready',
    label: 'Ready',
    description: 'Credentials are present locally.',
  };
}
