import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

export const SUPPORTED_PI_PROVIDER_IDS = [
  'anthropic',
  'deepseek',
  'google',
  'openai-codex',
  'opencode-go',
  'openrouter',
] as const;

export function isSupportedPiProviderId(providerId: string): boolean {
  return SUPPORTED_PI_PROVIDER_IDS.includes(providerId as (typeof SUPPORTED_PI_PROVIDER_IDS)[number]);
}

export function isSupportedPiModelKey(modelKey: string): boolean {
  const slashIndex = modelKey.indexOf('/');
  return slashIndex > 0 && isSupportedPiProviderId(modelKey.substring(0, slashIndex));
}

/** Shared pi-ai Models collection for the Pi adaptor. */
export const piAiModels = createModels();

piAiModels.setProvider(anthropicProvider());
piAiModels.setProvider(deepseekProvider());
piAiModels.setProvider(googleProvider());
piAiModels.setProvider(openaiCodexProvider());
piAiModels.setProvider(opencodeGoProvider());
piAiModels.setProvider(openrouterProvider());
