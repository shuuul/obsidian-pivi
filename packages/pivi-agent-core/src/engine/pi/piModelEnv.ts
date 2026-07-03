import type { Api, AuthResult, Model } from '@earendil-works/pi-ai';

import { CODEX_OAUTH_PROVIDER_ID } from '../../auth/piProviderCredentials';
import { resolveProviderAuth } from '../../auth/resolveProviderAuth';
import { getPiAgentSettings } from '../../foundation/agentSettings';
import { isValidModelKey } from '../../foundation/settingsModelKey';
import type { ModelAuthHost } from '../../ports';
import { piAiModels } from './piAiModels';
import {
  type PiResolvedModel,
  resolvePiModelFromKeyWithLookup,
} from './piModelRegistry';
import type { PiRuntimeHost } from './piRuntimeHost';

const PI_FALLBACK_MODEL_KEY = 'opencode-go/deepseek-v4-flash';

export function resolvePiModel(plugin: PiRuntimeHost, modelKey?: string): PiResolvedModel | null {
  const preferredKey = modelKey?.trim() || plugin.settings.model;

  if (preferredKey && isValidModelKey(preferredKey)) {
    const resolved = getModelByKey(preferredKey);
    if (resolved) return resolved;
  }

  const piSettings = getPiAgentSettings(plugin.settings);
  for (const visibleKey of piSettings.visibleModels) {
    const resolved = getModelByKey(visibleKey);
    if (resolved) return resolved;
  }

  return getModelByKey(PI_FALLBACK_MODEL_KEY);
}

export function resolvePiProviderAuth(
  plugin: PiRuntimeHost,
  model: Model<Api>,
  modelAuthHost: ModelAuthHost<Model<Api>, AuthResult> = piAiModelAuthHost,
): Promise<AuthResult | undefined> {
  const piSettings = getPiAgentSettings(plugin.settings);

  if (model.provider === CODEX_OAUTH_PROVIDER_ID) {
    plugin.getPiWorkspace?.()?.providerOAuth?.hasCodexAuth();
  }

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
