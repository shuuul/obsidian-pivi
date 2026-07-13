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
