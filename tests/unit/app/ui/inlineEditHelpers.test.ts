import {
  applyInlineEditAcceptance,
  buildInlineEditTurnContent,
  extractAssistantTextFromMessages,
} from '@/app/ui/inlineEditHelpers';

describe('inlineEditHelpers', () => {
  it('buildInlineEditTurnContent wraps selection and appends prompt', () => {
    expect(buildInlineEditTurnContent('Rewrite formally', 'hello world')).toBe(
      'Rewrite formally\n\n<selected_text>\nhello world\n</selected_text>',
    );
  });

  it('buildInlineEditTurnContent supports prompt-only turns', () => {
    expect(buildInlineEditTurnContent('', 'selection')).toBe(
      '<selected_text>\nselection\n</selected_text>',
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
