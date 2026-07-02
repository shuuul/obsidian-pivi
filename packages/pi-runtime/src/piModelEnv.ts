import type { Api, AuthResult, Model } from '@earendil-works/pi-ai';

import { CODEX_OAUTH_PROVIDER_ID } from './auth/ProviderOAuthService';
import { isProviderDisabled } from './auth/ProviderSecretStorage';
import type { PiRuntimeHost } from './host/runtimeHost';
import { piAiModels } from './model/piAiModels';
import { type PiResolvedModel, resolvePiModelFromKey } from './resolvePiModelFromKey';
import { getPiAgentSettings, isValidModelKey } from './settings/agentSettings';

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

export async function resolvePiProviderAuth(
  plugin: PiRuntimeHost,
  model: Model<Api>,
): Promise<AuthResult | undefined> {
  const piSettings = getPiAgentSettings(plugin.settings);
  if (isProviderDisabled(piSettings.disabledProviders, model.provider)) {
    return undefined;
  }

  if (model.provider === CODEX_OAUTH_PROVIDER_ID) {
    plugin.getPiWorkspace?.()?.providerOAuth?.hasCodexAuth();
  }

  return piAiModels.getAuth(model);
}

function getModelByKey(key: string): PiResolvedModel | null {
  try {
    return resolvePiModelFromKey(key);
  } catch {
    return null;
  }
}
