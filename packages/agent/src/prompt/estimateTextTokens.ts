export const ASCII_PROSE_CHARS_PER_TOKEN = 4;
export const ASCII_STRUCTURED_CHARS_PER_TOKEN = 3;

const FENCED_BLOCK = /^(?: {0,3})(`{3,}|~{3,})([^\n]*)(?:\n|$)([\s\S]*?)^(?: {0,3})\1[ \t]*(?:\n|$)/gm;
const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;

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

function isJson(text: string): boolean {
  const trimmed = text.trim();
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

function estimateSegment(text: string, structured: boolean): number {
  let asciiLetters = 0;
  let digits = 0;
  let punctuation = 0;
  let nonAscii = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0x7f) {
      if (LETTER.test(character)) {
        nonAscii += 0.78;
      } else if (NUMBER.test(character)) {
        digits += 1;
      } else if (!/\s/u.test(character)) {
        punctuation += 1;
      }
    } else if (/[A-Za-z]/.test(character)) {
      asciiLetters += 1;
    } else if (/[0-9]/.test(character)) {
      digits += 1;
    } else if (!/\s/.test(character)) {
      punctuation += 1;
    }
  }

  const significant = asciiLetters + digits + punctuation + nonAscii;
  const symbolDensity = significant === 0 ? 0 : (digits + punctuation) / significant;
  const densityAdjustment = Math.max(0, symbolDensity - 0.25)
    * (digits + punctuation) * (structured ? 0.15 : 0.55);
  const charsPerToken = structured ? 3.6 : ASCII_PROSE_CHARS_PER_TOKEN;
  return asciiLetters / charsPerToken
    + digits / 3
    + punctuation * 0.5
    + nonAscii
    + densityAdjustment;
}

/**
 * Tokenizer-independent estimate. Fenced code and JSON are scored separately;
 * CJK text and symbol density have calibrated weights. Provider-reported usage
 * remains authoritative whenever available.
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  let estimate = 0;
  let offset = 0;
  for (const match of text.matchAll(FENCED_BLOCK)) {
    const index = match.index;
    estimate += estimateSegment(text.slice(offset, index), false);
    const weighted = estimateSegment(match[0], true);
    const info = match[2]?.trim() ?? '';
    const body = match[3] ?? '';
    const fencedJson = /^jsonc?(?:\s|$)/i.test(info) || isJson(body);
    estimate += fencedJson
      ? Math.max(weighted, match[0].length / ASCII_STRUCTURED_CHARS_PER_TOKEN)
      : weighted;
    offset = index + match[0].length;
  }
  const remainder = text.slice(offset);
  const remainderIsJson = isJson(remainder);
  const remainderEstimate = estimateSegment(remainder, remainderIsJson);
  estimate += remainderIsJson
    ? Math.max(remainderEstimate, remainder.length / ASCII_STRUCTURED_CHARS_PER_TOKEN)
    : remainderEstimate;
  return Math.max(1, Math.ceil(estimate));
}
