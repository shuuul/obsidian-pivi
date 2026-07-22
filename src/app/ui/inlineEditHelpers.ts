import { appendContextFiles } from '@pivi/pivi-agent-core/context';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { Editor } from 'obsidian';

import { INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS } from '@/app/ui/inlineEditProtocol';

const SELECTED_TEXT_CLOSE_MARKER = '</selected_text>';
const ESCAPED_SELECTED_TEXT_CLOSE_MARKER = '</selected\u200b_text>';

/**
 * Escapes literal selected-text closing markers inside inline-edit selection payloads.
 *
 * Args:
 *   selectedText: Raw editor selection text.
 *
 * Returns:
 *   Selection text safe to embed inside `<selected_text>` blocks.
 */
export function escapeInlineEditSelectedText(selectedText: string): string {
  return selectedText.replaceAll(SELECTED_TEXT_CLOSE_MARKER, ESCAPED_SELECTED_TEXT_CLOSE_MARKER);
}

/** Builds the user turn text for inline edit from a prompt and selected editor text. */
export function buildInlineEditTurnContent(
  prompt: string,
  selectedText: string,
  contextFiles?: string[],
): string {
  const trimmedPrompt = prompt.trim();
  const selectionBlock = `<selected_text>\n${escapeInlineEditSelectedText(selectedText)}\n</selected_text>`;
  let content = trimmedPrompt
    ? `${trimmedPrompt}\n\n${INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS}\n\n${selectionBlock}`
    : `${INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS}\n\n${selectionBlock}`;

  if (contextFiles && contextFiles.length > 0) {
    content = appendContextFiles(content, contextFiles);
  }

  return content;
}

/** Concatenates text blocks from the last assistant message, skipping tool_use blocks. */
export function extractAssistantTextFromMessages(messages: readonly ChatMessage[]): string {
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant');
  if (!lastAssistant) {
    return '';
  }

  if (lastAssistant.contentBlocks && lastAssistant.contentBlocks.length > 0) {
    return lastAssistant.contentBlocks
      .filter((block): block is { type: 'text'; content: string } => block.type === 'text')
      .map(block => block.content)
      .join('');
  }

  return lastAssistant.content ?? '';
}

/** Replaces the editor range identified by CodeMirror offsets with the accepted text. */
export function applyInlineEditAcceptance(
  editor: Editor,
  fromOffset: number,
  toOffset: number,
  text: string,
): void {
  editor.replaceRange(
    text,
    editor.offsetToPos(fromOffset),
    editor.offsetToPos(toOffset),
  );
}
