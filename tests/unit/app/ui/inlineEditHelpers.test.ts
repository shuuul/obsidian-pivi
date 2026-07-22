import {
  applyInlineEditAcceptance,
  buildInlineEditTurnContent,
  escapeInlineEditSelectedText,
  extractAssistantTextFromMessages,
} from '@/app/ui/inlineEditHelpers';
import { INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS } from '@/app/ui/inlineEditProtocol';

describe('inlineEditHelpers', () => {
  it('buildInlineEditTurnContent places protocol instructions after the prompt', () => {
    expect(buildInlineEditTurnContent('Rewrite formally', 'hello world')).toBe(
      `Rewrite formally\n\n${INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS}\n\n<selected_text>\nhello world\n</selected_text>`,
    );
  });

  it('buildInlineEditTurnContent supports prompt-only turns', () => {
    expect(buildInlineEditTurnContent('', 'selection')).toBe(
      `${INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS}\n\n<selected_text>\nselection\n</selected_text>`,
    );
  });

  it('buildInlineEditTurnContent appends context files when provided', () => {
    expect(buildInlineEditTurnContent('Summarize', 'selection', ['notes/a.md', 'notes/b.md'])).toBe(
      `Summarize\n\n${INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS}\n\n<selected_text>\nselection\n</selected_text>\n\n<context_files>\nnotes/a.md, notes/b.md\n</context_files>`,
    );
  });

  it('escapes literal closing selected_text markers inside selection payloads', () => {
    expect(escapeInlineEditSelectedText('before </selected_text> after')).toBe(
      'before </selected\u200b_text> after',
    );
    expect(buildInlineEditTurnContent('Fix', 'before </selected_text> after')).toContain(
      'before </selected\u200b_text> after',
    );
  });

  it('extractAssistantTextFromMessages keeps text blocks only', () => {
    const text = extractAssistantTextFromMessages([
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'fallback',
        contentBlocks: [
          { type: 'text', content: 'Hello ' },
          { type: 'tool_use', toolId: 'tool-1' },
          { type: 'text', content: 'world' },
        ],
        timestamp: 2,
      },
    ]);
    expect(text).toBe('Hello world');
  });

  it('applyInlineEditAcceptance replaces the selected range', () => {
    const editor = {
      offsetToPos: jest.fn((offset: number) => ({ line: offset, ch: 0 })),
      replaceRange: jest.fn(),
    };
    applyInlineEditAcceptance(editor as never, 3, 9, 'replacement');
    expect(editor.offsetToPos).toHaveBeenCalledWith(3);
    expect(editor.offsetToPos).toHaveBeenCalledWith(9);
    expect(editor.replaceRange).toHaveBeenCalledWith(
      'replacement',
      { line: 3, ch: 0 },
      { line: 9, ch: 0 },
    );
  });
});
