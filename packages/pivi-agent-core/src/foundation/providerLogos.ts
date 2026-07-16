/**
 * Pi-ai provider id → stable icon slug mapping and model display helpers.
 * Slugs map to bundled lobe-icons SVG assets; Pivi does not load provider
 * icons from a remote CDN at runtime.
 */

/** Human-readable provider names (pi-ai provider ids). */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  google: 'Google Gemini',
  'kimi-coding': 'Kimi For Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI CN',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode-Go',
  openrouter: 'OpenRouter',
  xai: 'xAI',
  xiaomi: 'Xiaomi',
  'xiaomi-token-plan-cn': 'Xiaomi Token Plan CN',
  zai: 'Z.AI',
  'zai-coding-cn': 'Z.AI Coding CN',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'llama-cpp': 'llama.cpp',
};

/** pi-ai provider id → lobe-icons static SVG id. */
const PROVIDER_ID_TO_SLUG: Record<string, string> = {
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  google: 'google',
  'kimi-coding': 'kimi',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  moonshotai: 'moonshot',
  'moonshotai-cn': 'moonshot',
  openai: 'openai',
  'openai-codex': 'openai',
  opencode: 'opencode',
  'opencode-go': 'opencode',
  openrouter: 'openrouter',
  xai: 'xai',
  xiaomi: 'xiaomimimo',
  'xiaomi-token-plan-cn': 'xiaomimimo',
  zai: 'zai',
  'zai-coding-cn': 'zai',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  'llama-cpp': 'llama-cpp',
};

/** Custom provider kind → logo slug (null → Lucide fallback). */
export function getLogoSlugForCustomProviderKind(kind: string): string | null {
  switch (kind) {
    case 'openai-compatible':
    case 'openai-responses':
      return 'openai';
    case 'anthropic-compatible':
      return 'anthropic';
    default:
      return getProviderLogoSlug(kind);
  }
}

const MODEL_ICON_PATTERNS: [RegExp, string][] = [
  [/opus/i, 'gem'],
  [/sonnet/i, 'music'],
  [/haiku/i, 'feather'],
  [/claude/i, 'sparkles'],
  [/gpt/i, 'brain'],
  [/codex/i, 'code-2'],
  [/gemini/i, 'star'],
  [/llama/i, 'flame'],
  [/mistral/i, 'wind'],
  [/deepseek/i, 'search'],
  [/qwen/i, 'layers'],
];

export function getProviderIdFromModelValue(modelValue: string): string | null {
  const slash = modelValue.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  return modelValue.substring(0, slash);
}

export function getProviderDisplayName(providerId: string): string {
  if (PROVIDER_DISPLAY_NAMES[providerId]) {
    return PROVIDER_DISPLAY_NAMES[providerId];
  }
  return providerId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Returns a local icon slug for a pi-ai provider id, or null if unknown. */
export function getProviderLogoSlug(providerId: string): string | null {
  return PROVIDER_ID_TO_SLUG[providerId] ?? null;
}

export function getProviderLogoSlugFromModelValue(modelValue: string): string | null {
  const providerId = getProviderIdFromModelValue(modelValue);
  if (!providerId) {
    return null;
  }
  return getProviderLogoSlug(providerId);
}

/** Lucide icon name when no brand slug is available. */
export function getModelFallbackLucideIcon(modelValue: string, modelLabel: string): string {
  const combined = `${modelValue} ${modelLabel}`;
  for (const [pattern, icon] of MODEL_ICON_PATTERNS) {
    if (pattern.test(combined)) {
      return icon;
    }
  }
  return 'cpu';
}
