import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { Editor } from 'obsidian';

/** Builds the user turn text for inline edit from a prompt and selected editor text. */
export function buildInlineEditTurnContent(prompt: string, selectedText: string): string {
  const trimmedPrompt = prompt.trim();
  const selectionBlock = `<selected_text>\n${selectedText}\n</selected_text>`;
  if (!trimmedPrompt) {
    return selectionBlock;
  }
  return `${trimmedPrompt}\n\n${selectionBlock}`;
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
