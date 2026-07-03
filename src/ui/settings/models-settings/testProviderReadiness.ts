import { obsidianHttpClient } from '@pivi/obsidian-host/obsidianHttpClient';
import { isProviderDisabled } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import {
  type PiResolvedModel,
  resolvePiModelFromKeyWithLookup,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import { getProviderIdFromModelValue } from '@pivi/pivi-agent-core/foundation/providerLogos';
import type { PiAgentSettingsView } from '@pivi/pivi-agent-core/foundation/settingsModelKey';
import { testEndpointConnectivity } from '@pivi/pivi-agent-core/runtime/connectivity';

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
}

async function testResolvedModel(modelKey: string, model: PiResolvedModel): Promise<ProviderTestResult> {
  const auth = await piAiModels.getAuth(model);
  if (!auth) {
    return { ok: false, detail: `No credential resolved for ${modelKey}.` };
  }

  const baseUrl = typeof model.baseUrl === 'string' ? model.baseUrl.trim() : '';
  if (!baseUrl) {
    return {
      ok: true,
      detail: `Credentials resolved from ${auth.source}; this model has no endpoint URL to probe locally.`,
    };
  }

  return testEndpointConnectivity(obsidianHttpClient, baseUrl, {
    detailSuffix: `; credentials resolved from ${auth.source}.`,
  });
}

export async function testModelReadiness(
  modelKey: string,
  piSettings: Pick<PiAgentSettingsView, 'disabledProviders'>,
): Promise<ProviderTestResult> {
  const providerId = getProviderIdFromModelValue(modelKey);
  if (!providerId) {
    return { ok: false, detail: `${modelKey} is not a provider/model id.` };
  }
  if (isProviderDisabled(piSettings.disabledProviders, providerId)) {
    return { ok: false, detail: `${providerId} is disabled.` };
  }

  const model = resolvePiModelFromKeyWithLookup(modelKey, piAiModels);
  if (!model) {
    return { ok: false, detail: `No local model metadata is available for ${modelKey}.` };
  }

  return testResolvedModel(modelKey, model);
}

export async function testProviderReadiness(
  providerId: string,
  piSettings: Pick<PiAgentSettingsView, 'disabledProviders'>,
): Promise<ProviderTestResult> {
  if (isProviderDisabled(piSettings.disabledProviders, providerId)) {
    return { ok: false, detail: `${providerId} is disabled.` };
  }

  const model = piAiModels.getModels(providerId)[0];
  if (!model) {
    return { ok: false, detail: `No local model metadata is available for ${providerId}.` };
  }

  return testResolvedModel(providerId, model);
}
