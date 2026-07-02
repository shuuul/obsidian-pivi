/**
 * Pi-ai provider id → stable icon slug mapping and model display helpers.
 * Slugs map to bundled/local fallback icons; Pivi does not load provider icons
 * from a remote CDN at runtime.
 */

/** Human-readable provider names (pi-ai provider ids). */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  google: 'Google Gemini',
  'openai-codex': 'OpenAI Codex',
  'opencode-go': 'OpenCode-Go',
  openrouter: 'OpenRouter',
};

/** pi-ai provider id → stable local icon slug. */
const PROVIDER_ID_TO_SLUG: Record<string, string> = {
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  google: 'google',
  'openai-codex': 'openai',
  'opencode-go': 'opencode',
  openrouter: 'openrouter',
};

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

