export function parseEnvironmentVariables(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex > 0) {
      const key = normalized.substring(0, eqIndex).trim();
      let value = normalized.substring(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) {
        result[key] = value;
      }
    }
  }
  return result;
}

export function formatContextLimit(tokens: number): string {
  if (tokens >= 1_000_000) {
    const divisor = tokens % 1_000_000 === 0
      ? 1_000_000
      : tokens % 1_048_576 === 0
        ? 1_048_576
        : 1_000_000;
    return `${formatCompactValue(tokens / divisor)}M`;
  }
  if (tokens >= 1000) {
    const divisor = tokens % 1000 === 0
      ? 1000
      : tokens % 1024 === 0
        ? 1024
        : 1000;
    return `${formatCompactValue(tokens / divisor)}K`;
  }
  return tokens.toLocaleString();
}

function formatCompactValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}
