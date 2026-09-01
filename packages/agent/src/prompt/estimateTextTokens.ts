export const ASCII_PROSE_CHARS_PER_TOKEN = 4;
export const ASCII_STRUCTURED_CHARS_PER_TOKEN = 3;

export function looksStructured(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes('```') || trimmed.includes('~~~')) {
    return true;
  }
  if (!(
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Conservative tokenizer-independent estimate. CJK and other non-ASCII text
 * is charged per code point, while code/JSON uses a denser ASCII ratio than
 * prose. Provider-reported usage remains authoritative whenever available.
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  let asciiChars = 0;
  let nonAsciiTokens = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiChars += 1;
    } else {
      // Astral symbols commonly split into multiple model tokens.
      nonAsciiTokens += character.length === 2 ? 2 : 1;
    }
  }
  const charsPerToken = looksStructured(text)
    ? ASCII_STRUCTURED_CHARS_PER_TOKEN
    : ASCII_PROSE_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(asciiChars / charsPerToken) + nonAsciiTokens);
}
