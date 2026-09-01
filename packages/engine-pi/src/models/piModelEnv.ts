import type { Api, AuthResult, Model } from '@earendil-works/pi-ai';
import { resolveProviderAuth } from '@pivi/agent/auth/resolveProviderAuth';
import type { ModelAuthHost } from '@pivi/agent/ports';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { DEFAULT_MODEL_KEY } from '@pivi/agent/settings/defaults';
import { isValidModelKey } from '@pivi/agent/settings/modelKey';

import type { PiRuntimeHost } from '../runtime/piRuntimeHost';
import { piAiModels } from './piAiModels';
import {
  type PiResolvedModel,
  resolvePiModelFromKeyWithLookup,
} from './piModelRegistry';

const PI_FALLBACK_MODEL_KEY = DEFAULT_MODEL_KEY;

export function resolvePiModel(plugin: PiRuntimeHost, modelKey?: string): PiResolvedModel | null {
  const preferredKey = modelKey?.trim() || plugin.settings.model;

  if (preferredKey && isValidModelKey(preferredKey)) {
    const resolved = resolvePiModelByKey(preferredKey, plugin.settings.customContextLimits);
    if (resolved) return resolved;
  }

  const piSettings = getPiAgentSettings(plugin.settings);
  for (const visibleKey of piSettings.visibleModels) {
    const resolved = resolvePiModelByKey(visibleKey, plugin.settings.customContextLimits);
    if (resolved) return resolved;
  }

  return resolvePiModelByKey(PI_FALLBACK_MODEL_KEY, plugin.settings.customContextLimits);
}

/**
 * Resolves a model by explicit key only (no settings fallback). Used when the
 * serving provider/model comes from a runtime message rather than settings.
 */
export function resolvePiModelByKey(
  key: string,
  customContextLimits?: Readonly<Record<string, number>>,
): PiResolvedModel | null {
  if (!isValidModelKey(key)) {
    return null;
  }
  const model = getModelByKey(key);
  const configuredLimit = customContextLimits?.[key];
  if (
    !model
    || typeof configuredLimit !== 'number'
    || !Number.isFinite(configuredLimit)
    || configuredLimit <= 0
  ) {
    return model;
  }
  const contextWindow = Math.floor(configuredLimit);
  return {
    ...model,
    contextWindow,
    contextWindowIsAuthoritative: true,
    maxTokens: Math.min(model.maxTokens, contextWindow),
  };
}

export function resolvePiProviderAuth(
  plugin: PiRuntimeHost,
  model: Model<Api>,
  modelAuthHost: ModelAuthHost<Model<Api>, AuthResult> = piAiModelAuthHost,
): Promise<AuthResult | undefined> {
  const piSettings = getPiAgentSettings(plugin.settings);

  return resolveProviderAuth({ disabledProviders: piSettings.disabledProviders, model, modelAuthHost });
}

const piAiModelAuthHost: ModelAuthHost<Model<Api>, AuthResult> = {
  getAuth: (model) => piAiModels.getAuth(model),
};

function getModelByKey(key: string): PiResolvedModel | null {
  try {
    return resolvePiModelFromKeyWithLookup(key, piAiModels);
  } catch {
    return null;
  }
}
