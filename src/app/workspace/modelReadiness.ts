import { CODEX_OAUTH_PROVIDER_ID } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { deriveProviderReadinessStatus } from '@pivi/pivi-agent-core/auth/providerReadiness';
import { PI_AI_MODELS_CACHE } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { ObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import type { ProviderOAuthService } from '@pivi/pivi-agent-core/engine/pi/piProviderOAuthService';
import { getPiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import type {
  AppModelReadinessStatus,
  AppModelTestResult,
} from '@pivi/pivi-agent-core/foundation/modelReadiness';
import { getProviderIdFromModelValue } from '@pivi/pivi-agent-core/foundation/providerLogos';

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
  const codexConnected = providerId === CODEX_OAUTH_PROVIDER_ID
    ? context.providerOAuth.hasCodexAuth()
    : false;

  const custom = piSettings.customProviders.find((provider) => provider.id === providerId);
  const allowKeyless = !!custom && custom.apiKeyRequired === false;

  return deriveProviderReadinessStatus({
    providerId,
    piSettings,
    credential: context.credentialStore?.readSync(providerId),
    codexConnected,
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
