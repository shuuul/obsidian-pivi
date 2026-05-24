import * as piAi from '@earendil-works/pi-ai';

import type ObsiusPlugin from '../../main';
import { parseEnvironmentVariables } from '../../utils/env';
import { maybeGetPiWorkspaceServices } from '../app/PiWorkspaceServices';
import { CODEX_OAUTH_PROVIDER_ID } from '../auth/ProviderOAuthService';
import { getPiAgentSettings, isValidModelKey } from '../settings';

const PI_FALLBACK_MODEL_KEY = 'anthropic/claude-sonnet-4-20250514';

export function resolvePiModel(plugin: ObsiusPlugin, modelKey?: string): ReturnType<typeof piAi.getModel> | null {
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

export function resolvePiApiKey(plugin: ObsiusPlugin, provider: string): string | undefined {
  if (provider === CODEX_OAUTH_PROVIDER_ID) {
    const codexToken = maybeGetPiWorkspaceServices()?.providerOAuth?.getCodexAccessTokenSync();
    if (codexToken) {
      return codexToken;
    }
  }

  const piSettings = getPiAgentSettings(plugin.settings);
  const parsedEnv = parseEnvironmentVariables(piSettings.environmentVariables);
  const parsedSharedEnv = parseEnvironmentVariables(plugin.settings.sharedEnvironmentVariables);

  const keyMap: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
    openai: ['OPENAI_API_KEY'],
    'openai-codex': ['OPENAI_API_KEY'],
    google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    'google-vertex': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    opencode: ['OPENCODE_API_KEY'],
    'opencode-go': ['OPENCODE_API_KEY'],
  };

  const envKeys = keyMap[provider] ?? [`${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`];

  for (const key of envKeys) {
    const value = parsedEnv[key] ?? parsedSharedEnv[key] ?? process.env[key];
    if (value) return value;
  }

  return undefined;
}

function getModelByKey(key: string): ReturnType<typeof piAi.getModel> | null {
  try {
    const slashIndex = key.indexOf('/');
    if (slashIndex <= 0) return null;
    const provider = key.substring(0, slashIndex);
    const modelId = key.substring(slashIndex + 1);
    return (piAi.getModel as (provider: string, modelId: string) => ReturnType<typeof piAi.getModel>)(
      provider,
      modelId,
    );
  } catch {
    return null;
  }
}
