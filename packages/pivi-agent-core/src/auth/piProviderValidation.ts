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
  'xiaomi',
  'xiaomi-token-plan-cn',
  'zai',
  'zai-coding-cn',
] as const;

export type SupportedPiProviderId = (typeof SUPPORTED_PI_PROVIDER_IDS)[number];

export function isSupportedPiProviderId(providerId: string): boolean {
  return SUPPORTED_PI_PROVIDER_IDS.includes(providerId as SupportedPiProviderId);
}

export function isSupportedPiModelKey(modelKey: string): boolean {
  const slashIndex = modelKey.indexOf('/');
  return slashIndex > 0 && isSupportedPiProviderId(modelKey.substring(0, slashIndex));
}
