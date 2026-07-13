import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';

export function calculateUsagePercentage(tokens: number, limit: number): number {
  return limit > 0
    ? Math.min(100, Math.max(0, Math.round((tokens / limit) * 100)))
    : 0;
}

/** Input-ring metric: prompt input tokens against the model context window budget. */
export function calculateInputUsagePercentage(usage: UsageInfo): number {
  return calculateUsagePercentage(usage.inputTokens, usage.contextWindow);
}

/**
 * Compact token labels for meter tooltips / aria text (e.g. `900`, `1k`, `12k`, `3.4m`).
 * Matches the pre-React ContextUsageMeter formatTokens contract.
 */
export function formatCompactTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return '0';
  const sign = tokens < 0 ? '-' : '';
  const abs = Math.abs(tokens);
  if (abs >= 1_000_000) {
    return `${sign}${Math.round(abs / 100_000) / 10}m`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function recalculateUsageForModel(
  usage: UsageInfo,
  model: string,
  fallbackContextWindow: number,
): UsageInfo {
  const preserveAuthoritativeWindow = usage.contextWindowIsAuthoritative === true
    && usage.contextWindow > 0
    && usage.model === model;
  const contextWindow = preserveAuthoritativeWindow ? usage.contextWindow : fallbackContextWindow;

  return {
    ...usage,
    model,
    contextWindow,
    contextWindowIsAuthoritative: preserveAuthoritativeWindow,
    // Keep stored percentage aligned with the composer input ring (inputTokens / window).
    percentage: calculateUsagePercentage(usage.inputTokens, contextWindow),
  };
}
