import type { UsageInfo } from './chat';

export function calculateUsagePercentage(tokens: number, limit: number): number {
  return limit > 0
    ? Math.min(100, Math.max(0, Math.round((tokens / limit) * 100)))
    : 0;
}

/** Input-ring metric: prompt input tokens against the model context window budget. */
export function calculateInputUsagePercentage(usage: UsageInfo): number {
  return calculateUsagePercentage(usage.inputTokens, usage.contextWindow);
}

export function recalculateUsageForModel(
  usage: UsageInfo,
  model: string,
  fallbackContextWindow: number | null,
): UsageInfo {
  const preserveAuthoritativeWindow = usage.contextWindowIsAuthoritative === true
    && usage.contextWindow > 0
    && usage.model === model;
  const contextWindow = preserveAuthoritativeWindow
    ? usage.contextWindow
    : fallbackContextWindow ?? 0;

  return {
    ...usage,
    model,
    contextWindow,
    contextWindowIsAuthoritative: preserveAuthoritativeWindow,
    // Keep stored percentage aligned with the composer input ring (inputTokens / window).
    percentage: calculateUsagePercentage(usage.inputTokens, contextWindow),
  };
}
