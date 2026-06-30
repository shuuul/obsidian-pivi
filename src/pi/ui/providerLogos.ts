/**
 * Pi-ai provider id → stable icon slug mapping and model display helpers.
 * Slugs map to bundled/local fallback icons; Pivi does not load provider icons
 * from a remote CDN at runtime.
 */

/** Human-readable provider names (pi-ai provider ids). */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'amazon-bedrock': 'Amazon Bedrock',
  anthropic: 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks AI',
  'github-copilot': 'GitHub Copilot',
  google: 'Google Gemini',
  'google-vertex': 'Google Cloud Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi for Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax China',
  mistral: 'Mistral AI',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (China)',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode-Go',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI Grok',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-ams': 'Xiaomi MiMo (AMS)',
  'xiaomi-token-plan-cn': 'Xiaomi MiMo (China)',
  'xiaomi-token-plan-sgp': 'Xiaomi MiMo (SGP)',
  zai: 'ZAI',
};

/** pi-ai provider id → stable local icon slug. */
const PROVIDER_ID_TO_SLUG: Record<string, string> = {
  'amazon-bedrock': 'bedrock',
  anthropic: 'anthropic',
  'azure-openai-responses': 'azure',
  cerebras: 'cerebras',
  'cloudflare-ai-gateway': 'cloudflare',
  'cloudflare-workers-ai': 'cloudflare',
  deepseek: 'deepseek',
  fireworks: 'fireworks',
  'github-copilot': 'githubcopilot',
  google: 'google',
  'google-vertex': 'google',
  groq: 'groq',
  huggingface: 'huggingface',
  'kimi-coding': 'moonshot',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  mistral: 'mistral',
  moonshotai: 'moonshot',
  'moonshotai-cn': 'moonshot',
  openai: 'openai',
  'openai-codex': 'openai',
  opencode: 'opencode',
  'opencode-go': 'opencode',
  openrouter: 'openrouter',
  together: 'together',
  'vercel-ai-gateway': 'vercel',
  xai: 'xai',
  zai: 'zhipu',
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

export function collectProviderLogoSlugs(providerIds: Iterable<string>): string[] {
  const slugs = new Set<string>();
  for (const id of providerIds) {
    const slug = getProviderLogoSlug(id);
    if (slug) {
      slugs.add(slug);
    }
  }
  return [...slugs];
}
