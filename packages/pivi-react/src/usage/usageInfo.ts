/** Compact token labels for meter tooltips and aria text. */
export function formatCompactTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return '0';
  const sign = tokens < 0 ? '-' : '';
  const abs = Math.abs(tokens);
  if (abs >= 1_000_000) {
    return `${sign}${Math.round(abs / 100_000) / 10}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Compact tokens/s label; one decimal below 100, otherwise a whole number. */
export function formatTokensPerSecond(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0';
  if (rate >= 100) return String(Math.round(rate));
  const rounded = Math.round(rate * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
