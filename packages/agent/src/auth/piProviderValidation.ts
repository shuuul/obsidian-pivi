import { isSubscriptionOAuthProviderId } from './piProviderCredentials';

export const SUPPORTED_PI_PROVIDER_IDS = [
  'anthropic',
  'deepseek',
  'google',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'zai',
  'zai-coding-cn',
] as const;

export type SupportedPiProviderId = (typeof SUPPORTED_PI_PROVIDER_IDS)[number];

export function isBuiltinPiProviderId(providerId: string): boolean {
  return SUPPORTED_PI_PROVIDER_IDS.includes(providerId as SupportedPiProviderId);
}

/** Built-in cloud providers only. Prefer isKnownPiProviderId when custom providers exist. */
export function isSupportedPiProviderId(providerId: string): boolean {
  return isBuiltinPiProviderId(providerId);
}

export function isKnownPiProviderId(
  providerId: string,
  customProviderIds?: readonly string[],
): boolean {
  if (isBuiltinPiProviderId(providerId)) {
    return true;
  }
  if (isSubscriptionOAuthProviderId(providerId)) {
    return true;
  }
  return customProviderIds?.includes(providerId) ?? false;
}

export function isSupportedPiModelKey(
  modelKey: string,
  customProviderIds?: readonly string[],
): boolean {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return false;
  }
  return isKnownPiProviderId(modelKey.substring(0, slashIndex), customProviderIds);
}
