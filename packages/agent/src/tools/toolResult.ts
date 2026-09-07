export const DEFAULT_TOOL_RESULT_CHARS = 50_000;

/** Truncate model-visible tool text with an explicit continuation marker. */
export function capToolResultText(
  output: string,
  options: { maxChars?: number; label?: string } = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_TOOL_RESULT_CHARS;
  const label = options.label ?? 'output';
  if (output.length <= maxChars) {
    return output;
  }
  const marker = `\n\n[${label} truncated to ${maxChars} characters]`;
  const budget = Math.max(0, maxChars - marker.length);
  return `${output.slice(0, budget)}${marker}`;
}

/** Standard Pi agent tool result shape for text-only outputs. */
export function textResult(
  text: string,
  details: Record<string, unknown> = {},
): {
  content: [{ type: 'text'; text: string }];
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}
