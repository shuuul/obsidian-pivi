import { INTERACTIVE_OAUTH_PROVIDER_IDS } from '@pivi/agent/auth/piProviderCredentials';
import { deriveProviderReadinessStatus } from '@pivi/agent/auth/providerReadiness';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { getProviderIdFromModelValue } from '@pivi/agent/settings/modelDisplay';
import type {
  AppModelReadinessStatus,
  AppModelTestResult,
} from '@pivi/agent/settings/modelReadiness';
import type { ObsidianCredentialStore } from '@pivi/engine-pi/application/auth';
import { PI_AI_MODELS_CACHE } from '@pivi/engine-pi/application/models';
import type { ProviderOAuthService } from '@pivi/engine-pi/application/oauth';

import { testModelReadiness, testProviderReadiness } from './providerReadiness';

export interface PiModelReadinessContext {
  credentialStore: ObsidianCredentialStore | null;
  providerOAuth: ProviderOAuthService;
}

function unavailableStatus(description: string): AppModelReadinessStatus {
  return {
    kind: 'unavailable',
    label: 'Unavailable',
    description,
  };
}

export function derivePiModelReadinessStatus(
  model: string,
  settings: Record<string, unknown>,
  context: PiModelReadinessContext,
): AppModelReadinessStatus {
  const providerId = getProviderIdFromModelValue(model);
  if (!providerId) {
    return unavailableStatus('This model id is not in provider/model format.');
  }

  const piSettings = getPiAgentSettings(settings);
  const interactiveOAuthConnected = (INTERACTIVE_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId)
    ? context.providerOAuth.hasProviderOAuth(providerId)
    : false;

  const custom = piSettings.customProviders.find((provider) => provider.id === providerId);
  const allowKeyless = !!custom && custom.apiKeyRequired === false;

  return deriveProviderReadinessStatus({
    providerId,
    piSettings,
    credential: context.credentialStore?.readSync(providerId),
    interactiveOAuthConnected,
    modelCount: PI_AI_MODELS_CACHE.has(model) ? 1 : 0,
    allowKeyless,
  });
}

export async function runPiModelReadinessTest(
  model: string,
  settings: Record<string, unknown>,
): Promise<AppModelTestResult> {
  return testModelReadiness(model, getPiAgentSettings(settings));
}

export async function runPiProviderReadinessTest(
  providerId: string,
  settings: Record<string, unknown>,
): Promise<AppModelTestResult> {
  return testProviderReadiness(providerId, getPiAgentSettings(settings));
}
