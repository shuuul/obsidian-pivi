/** Extract concatenated text from Pi/MCP content blocks. */
export function extractTextContent(
  content: ReadonlyArray<{ type: string; text?: string }> | undefined,
): string {
  if (!content?.length) {
    return '';
  }
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}
