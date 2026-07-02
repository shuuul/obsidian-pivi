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
