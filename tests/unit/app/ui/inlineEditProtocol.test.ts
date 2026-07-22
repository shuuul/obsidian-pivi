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

  it('discards wrapping text outside closed tags', () => {
    expect(
      parseInlineEditTurnResponse('Here is the edit:\n<replacement>Fixed text</replacement>'),
    ).toEqual({
      kind: 'replacement',
      text: 'Fixed text',
    });
  });

  it('prefers the first closed tag when both appear', () => {
    expect(
      parseInlineEditTurnResponse('<insertion>first</insertion><replacement>second</replacement>'),
    ).toEqual({
      kind: 'insertion',
      text: 'first',
    });

    expect(
      parseInlineEditTurnResponse('<replacement>first</replacement><insertion>second</insertion>'),
    ).toEqual({
      kind: 'replacement',
      text: 'first',
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
      kind: 'insertion',
      text: 'partial content',
    });
  });

  it('preserves fenced code blocks in reply text', () => {
    const response = '```ts\nconst answer = 1;\n```';
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
});
