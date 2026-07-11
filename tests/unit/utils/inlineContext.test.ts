import {
  appendInlineContexts,
  buildMarkedSelectionText,
  createInlineContextToken,
  extractInlineContextTokensFromMessage,
  formatSelectionRangeAttribute,
  normalizeEditorSelection,
  parseInlineContextToken,
} from '@pivi/pivi-agent-core/context/inlineContext';
import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

describe('normalizeEditorSelection', () => {
  it('swaps reversed selections', () => {
    const normalized = normalizeEditorSelection(
      { line: 14, ch: 20 },
      { line: 12, ch: 8 },
    );
    expect(normalized.from).toEqual({ line: 12, ch: 8 });
    expect(normalized.to).toEqual({ line: 14, ch: 20 });
    expect(normalized.includedLineFrom).toBe(12);
    expect(normalized.includedLineTo).toBe(14);
  });
});

describe('buildMarkedSelectionText', () => {
  const lines = [
    'line 12 before selected',
    'line 13 selected text',
    'line 14 selected end after',
  ];
  const getLine = (line: number) => lines[line - 12] ?? '';

  it('marks a single-line partial selection', () => {
    const text = buildMarkedSelectionText(
      getLine,
      { line: 12, ch: 8 },
      { line: 12, ch: 14 },
    );
    expect(text).toBe('line 12 <selection_start>before<selection_end> selected');
  });

  it('marks a multi-line partial selection', () => {
    const text = buildMarkedSelectionText(
      getLine,
      { line: 12, ch: 8 },
      { line: 14, ch: 13 },
    );
    expect(text).toContain('line 12 <selection_start>before selected');
    expect(text).toContain('line 13 selected text');
    expect(text).toContain('selec<selection_end>ted end after');
  });

  it('marks a full-line selection', () => {
    const selectedLine = lines.at(1);
    expect(selectedLine).toBeDefined();
    if (!selectedLine) throw new Error('Expected the selected fixture line');
    const text = buildMarkedSelectionText(
      getLine,
      { line: 13, ch: 0 },
      { line: 13, ch: selectedLine.length },
    );
    expect(text).toBe('<selection_start>line 13 selected text<selection_end>');
  });

  it('preserves angle brackets in selected markdown', () => {
    const bracketLines = ['see <https://example.com> and [[link]]'];
    const [bracketLine] = bracketLines;
    expect(bracketLine).toBeDefined();
    if (!bracketLine) throw new Error('Expected the bracket fixture line');
    const marked = buildMarkedSelectionText(
      (line) => line === 0 ? bracketLine : '',
      { line: 0, ch: 4 },
      { line: 0, ch: 28 },
    );
    expect(marked).toContain('<selection_start>');
    expect(marked).toContain('<https://example.com>');
  });
});

describe('formatSelectionRangeAttribute', () => {
  it('uses 1-indexed line and column', () => {
    expect(formatSelectionRangeAttribute(
      { line: 11, ch: 8 },
      { line: 13, ch: 20 },
    )).toBe('12:9-14:21');
  });
});

describe('appendInlineContexts', () => {
  it('appends inline_contexts after user text', () => {
    const contexts: InlineContextReference[] = [{
      type: 'editor-selection',
      notePath: 'notes/example.md',
      noteName: 'example.md',
      selection: {
        from: { line: 11, ch: 8 },
        to: { line: 13, ch: 20 },
      },
      includedLines: { from: 12, to: 14 },
      text: 'line with <selection_start>sel<selection_end>',
    }];

    const prompt = appendInlineContexts('Summarize this', contexts);
    expect(prompt).toContain('Summarize this');
    expect(prompt).toContain('<inline_contexts>');
    expect(prompt).toContain('path="notes/example.md"');
    expect(prompt).toContain('range="12:9-14:21"');
    expect(prompt).toContain('included_lines="12-14"');
    expect(prompt).toContain('<selection_start>sel<selection_end>');
  });
});

describe('inline context tokens', () => {
  const context: InlineContextReference = {
    type: 'editor-selection',
    notePath: 'notes/example.md',
    noteName: 'example.md',
    selection: {
      from: { line: 1, ch: 2 },
      to: { line: 2, ch: 8 },
    },
    includedLines: { from: 2, to: 3 },
    text: 'xx<selection_start>selected\ntext<selection_end>',
  };

  it('round-trips inline context tokens', () => {
    const token = createInlineContextToken(context);
    expect(token).toMatch(/^@\[pivi-inline-context:/);
    expect(parseInlineContextToken(token)).toEqual(context);
  });

  it('extracts inline context tokens and strips them from user text', () => {
    const token = createInlineContextToken(context);
    const extracted = extractInlineContextTokensFromMessage(`Explain this ${token} please`);

    expect(extracted.messageWithoutInlineContextTokens).toBe('Explain this please');
    expect(extracted.contexts).toEqual([context]);
  });
});
