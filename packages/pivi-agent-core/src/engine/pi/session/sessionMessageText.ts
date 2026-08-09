function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractAgentTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } => (
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    ))
    .map(part => part.text)
    .join('');
}

export function normalizeVisibleUserText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
