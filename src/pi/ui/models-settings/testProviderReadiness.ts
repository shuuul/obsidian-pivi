import { requestUrl } from 'obsidian';

import { isProviderDisabled } from '../../auth/ProviderSecretStorage';
import { piAiModels } from '../../piAiModels';
import type { PiAgentSettingsView } from '../../settings';
import { PI_AI_MODELS_CACHE } from '../PiChatUIConfig';
import { getProviderIdFromModelValue } from '../providerLogos';

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
}

function resolveModel(modelKey: string) {
  const cached = PI_AI_MODELS_CACHE.get(modelKey);
  if (cached) {
    return cached;
  }

  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  try {
    return piAiModels.getModel(
      modelKey.substring(0, slashIndex),
      modelKey.substring(slashIndex + 1),
    ) ?? null;
  } catch {
    return null;
  }
}

async function testResolvedModel(modelKey: string, model: NonNullable<ReturnType<typeof resolveModel>>): Promise<ProviderTestResult> {
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

  try {
    const response = await requestUrl({
      url: baseUrl,
      method: 'HEAD',
      throw: false,
    });
    return {
      ok: response.status >= 200 && response.status < 500,
      detail: `${baseUrl} responded with status ${response.status}; credentials resolved from ${auth.source}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `${baseUrl}: ${message}` };
  }
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

  const model = resolveModel(modelKey);
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
