import type {
  AppModelReadinessStatus,
  AppModelTestResult,
} from '../app/serviceContracts';
import type { ObsidianCredentialStore } from '../auth/ObsidianCredentialStore';
import type { ProviderOAuthService } from '../auth/ProviderOAuthService';
import { CODEX_OAUTH_PROVIDER_ID } from '../auth/ProviderOAuthService';
import { getPiAgentSettings } from '../settings/agentSettings';
import { deriveProviderReadinessStatus } from './models-settings/providerStatus';
import { testModelReadiness } from './models-settings/testProviderReadiness';
import { PI_AI_MODELS_CACHE } from './PiChatUIConfig';
import { getProviderIdFromModelValue } from './providerLogos';

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

  return deriveProviderReadinessStatus({
    providerId,
    piSettings,
    credential: context.credentialStore?.readSync(providerId),
    codexConnected,
    modelCount: PI_AI_MODELS_CACHE.has(model) ? 1 : 0,
  });
}

export async function runPiModelReadinessTest(
  model: string,
  settings: Record<string, unknown>,
): Promise<AppModelTestResult> {
  return testModelReadiness(model, getPiAgentSettings(settings));
}
