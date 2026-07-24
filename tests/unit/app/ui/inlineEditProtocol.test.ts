import {
  INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS,
  parseInlineEditTurnResponse,
  stripInlineEditStreamingProtocolTags,
} from '@/app/ui/inlineEditProtocol';

describe('inlineEditProtocol', () => {
  it('parses replacement tags', () => {
    expect(parseInlineEditTurnResponse('<replacement>Fixed text</replacement>')).toEqual({
      kind: 'replacement',
      text: 'Fixed text',
    });
  });

  it('parses insertion tags', () => {
    expect(parseInlineEditTurnResponse('<insertion>inserted text</insertion>')).toEqual({
      kind: 'insertion',
      text: 'inserted text',
    });
  });

  it('parses unlabeled non-empty text as reply', () => {
    expect(parseInlineEditTurnResponse('Could you clarify what you mean?')).toEqual({
      kind: 'reply',
      text: 'Could you clarify what you mean?',
    });
  });

  it('parses empty and whitespace-only responses as empty', () => {
    expect(parseInlineEditTurnResponse('')).toEqual({ kind: 'empty' });
    expect(parseInlineEditTurnResponse('   \n\t  ')).toEqual({ kind: 'empty' });
  });

  it('treats a tagged edit with wrapping explanation as a reply', () => {
    const response = 'Here is the edit:\n<replacement>Fixed text</replacement>';
    expect(parseInlineEditTurnResponse(response)).toEqual({
      kind: 'reply',
      text: response,
    });
  });

  it('treats multiple edit envelopes as a reply', () => {
    const response = '<insertion>first</insertion><replacement>second</replacement>';
    expect(parseInlineEditTurnResponse(response)).toEqual({
      kind: 'reply',
      text: 'firstsecond',
    });
  });

  it('falls back to reply for unclosed tags and strips protocol residue', () => {
    expect(parseInlineEditTurnResponse('<replacement>unfinished edit')).toEqual({
      kind: 'reply',
      text: 'unfinished edit',
    });
    expect(
      parseInlineEditTurnResponse('I started: <insertion>partial content</insertion> and stopped'),
    ).toEqual({
      kind: 'reply',
      text: 'I started: <insertion>partial content</insertion> and stopped',
    });
  });

  it('preserves fenced code blocks in reply text', () => {
    const response = '```ts\nconst answer = 1;\n```';
    expect(parseInlineEditTurnResponse(response)).toEqual({
      kind: 'reply',
      text: response,
    });
  });

  it('does not interpret protocol tags quoted by a plain-text explanation as an edit', () => {
    const response = [
      '这段话是在说明输出格式规则：',
      '',
      '- 要替换文字时返回：',
      '  ```text',
      '  <replacement>新内容</replacement>',
      '  ```',
      '- 要插入文字时返回 `<insertion>新内容</insertion>`。',
    ].join('\n');

    expect(parseInlineEditTurnResponse(response)).toEqual({
      kind: 'reply',
      text: response,
    });
  });

  it('exports protocol instructions for turn construction', () => {
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain('<replacement>');
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain('<insertion>');
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain('markdown code fences');
  });

  it('prioritizes output-only requests over edit-shaped tasks', () => {
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain(
      'only OUTPUT, SHOW, or DISPLAY the result',
    );
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain(
      'explicitly says not to replace, insert, or modify the selected text',
    );
    expect(INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS).toContain(
      'ambiguous whether the user wants an edit or output only',
    );
  });
});

describe('stripInlineEditStreamingProtocolTags', () => {
  it('hides a partial protocol open tag until content starts', () => {
    expect(stripInlineEditStreamingProtocolTags('<')).toBe('');
    expect(stripInlineEditStreamingProtocolTags('<repl')).toBe('');
    expect(stripInlineEditStreamingProtocolTags('\n<insertion')).toBe('');
  });

  it('strips leading protocol open tags during streaming', () => {
    expect(stripInlineEditStreamingProtocolTags('<replacement>updated text')).toBe('updated text');
    expect(stripInlineEditStreamingProtocolTags('\n<insertion>new line')).toBe('new line');
  });

  it('removes residual close tags from streamed text', () => {
    expect(stripInlineEditStreamingProtocolTags('<replacement>updated</replacement>')).toBe('updated');
  });

  it('preserves protocol tags quoted inside a streaming explanation', () => {
    const response = 'To replace text, return `<replacement>updated</replacement>`.';
    expect(stripInlineEditStreamingProtocolTags(response)).toBe(response);
  });
});
