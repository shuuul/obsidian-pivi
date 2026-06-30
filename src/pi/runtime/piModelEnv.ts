import type { Api, AuthResult, Model } from '@earendil-works/pi-ai';

import type PiviPlugin from '../../main';
import { maybeGetPiWorkspaceServices } from '../app/PiWorkspaceServices';
import { CODEX_OAUTH_PROVIDER_ID } from '../auth/ProviderOAuthService';
import { isProviderDisabled } from '../auth/ProviderSecretStorage';
import { piAiModels } from '../piAiModels';
import { getPiAgentSettings, isValidModelKey } from '../settings';
import { type PiResolvedModel, resolvePiModelFromKey } from './resolvePiModelFromKey';

const PI_FALLBACK_MODEL_KEY = 'opencode-go/deepseek-v4-flash';

export function resolvePiModel(plugin: PiviPlugin, modelKey?: string): PiResolvedModel | null {
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
  plugin: PiviPlugin,
  model: Model<Api>,
): Promise<AuthResult | undefined> {
  const piSettings = getPiAgentSettings(plugin.settings);
  if (isProviderDisabled(piSettings.disabledProviders, model.provider)) {
    return undefined;
  }

  if (model.provider === CODEX_OAUTH_PROVIDER_ID) {
    maybeGetPiWorkspaceServices()?.providerOAuth?.hasCodexAuth();
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
