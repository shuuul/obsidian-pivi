/** Parsed outcome of one inline-edit assistant turn. */
export type InlineEditTurnResult =
  | { kind: 'replacement'; text: string }
  | { kind: 'insertion'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'empty' };

const CLOSED_REPLACEMENT_PATTERN = /<replacement>([\s\S]*?)<\/replacement>/;
const CLOSED_INSERTION_PATTERN = /<insertion>([\s\S]*?)<\/insertion>/;
const OPEN_REPLACEMENT_PATTERN = /<replacement>/;
const OPEN_INSERTION_PATTERN = /<insertion>/;
const STREAMING_OPEN_TAG_PATTERN = /^[\s\n]*<(?:replacement|insertion)>/;
const STREAMING_CLOSE_TAG_PATTERN = /<\/(?:replacement|insertion)>/g;
const PROTOCOL_TAG_RESIDUE_PATTERN = /<\/?(?:replacement|insertion)>/g;
const STREAMING_OPEN_TAGS = ['<replacement>', '<insertion>'] as const;

/** English protocol instructions prepended to inline-edit user turns. */
export const INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS = [
  '## Inline edit response protocol',
  '',
  'The user\'s requested output mode takes priority over whether the task could be applied as an edit.',
  'If the user asks to only OUTPUT, SHOW, or DISPLAY the result (including a translation), or explicitly says not to replace, insert, or modify the selected text, respond with plain text and do NOT use tags.',
  'If it is ambiguous whether the user wants an edit or output only, respond with plain text and do NOT use tags.',
  '',
  'If the user wants to MODIFY or REPLACE the selected text, respond with ONLY the complete new text wrapped in <replacement> tags:',
  '<replacement>your replacement text here</replacement>',
  '',
  'If the user wants to INSERT new content, respond with ONLY the inserted text wrapped in <insertion> tags:',
  '<insertion>your inserted text here</insertion>',
  '',
  'If the user is asking a QUESTION or needs clarification, respond with plain text and do NOT use tags.',
  '',
  'Do not wrap edit results in markdown code fences unless the user explicitly requests it.',
].join('\n');

/**
 * Strips inline-edit protocol tags from in-flight streaming assistant text for display.
 *
 * Removes a leading `<replacement>` / `<insertion>` open tag and any residual close tags.
 */
export function stripInlineEditStreamingProtocolTags(text: string): string {
  const trimmedStart = text.trimStart();
  if (STREAMING_OPEN_TAGS.some(tag => tag.startsWith(trimmedStart))) {
    return '';
  }
  const withoutOpenTag = text.replace(STREAMING_OPEN_TAG_PATTERN, '');
  return withoutOpenTag.replace(STREAMING_CLOSE_TAG_PATTERN, '');
}

/**
 * Parses an inline-edit assistant response into a replacement, insertion, reply, or empty result.
 *
 * Closed `<replacement>` / `<insertion>` tags take precedence; when both appear, the first tag wins.
 * Unclosed tags fall back to a trimmed reply. Whitespace-only input is empty.
 */
export function parseInlineEditTurnResponse(responseText: string): InlineEditTurnResult {
  const replacementMatch = responseText.match(CLOSED_REPLACEMENT_PATTERN);
  const insertionMatch = responseText.match(CLOSED_INSERTION_PATTERN);
  const replacementIndex = replacementMatch?.index ?? -1;
  const insertionIndex = insertionMatch?.index ?? -1;

  if (replacementMatch && replacementIndex >= 0 && (insertionIndex < 0 || replacementIndex <= insertionIndex)) {
    return { kind: 'replacement', text: replacementMatch[1] ?? '' };
  }

  if (insertionMatch && insertionIndex >= 0) {
    return { kind: 'insertion', text: insertionMatch[1] ?? '' };
  }

  const hasUnclosedTag =
    OPEN_REPLACEMENT_PATTERN.test(responseText) || OPEN_INSERTION_PATTERN.test(responseText);
  const trimmed = responseText.trim();

  if (!trimmed) {
    return { kind: 'empty' };
  }

  if (hasUnclosedTag) {
    // Unclosed protocol tags mean the model started an edit but never finished it;
    // show the text as a reply without leaking protocol markers.
    return { kind: 'reply', text: trimmed.replace(PROTOCOL_TAG_RESIDUE_PATTERN, '').trim() };
  }

  return { kind: 'reply', text: trimmed };
}
