import {
  extractUserQuery,
  resolveUserMessageDisplayText,
} from '@pivi/pivi-agent-core/context/context';

describe('extractUserQuery', () => {
  it('strips context-only turns with no user text', () => {
    const withDoubleNewline = [
      '',
      '<current_note>',
      'inbox/paper/CryoFastAR.md',
      '</current_note>',
      '',
      '<context_files>',
      'inbox/paper/CryoFastAR.md',
      '</context_files>',
    ].join('\n');
    expect(extractUserQuery(withDoubleNewline)).toBe('');

    const withoutLeadingSeparator = [
      '<current_note>',
      'inbox/paper/CryoFastAR.md',
      '</current_note>',
      '',
      '<context_files>',
      'inbox/paper/CryoFastAR.md',
      '</context_files>',
    ].join('\n');
    expect(extractUserQuery(withoutLeadingSeparator)).toBe('');
  });

  it('keeps user text before context XML', () => {
    const persisted = [
      'Summarize this paper',
      '',
      '<current_note>',
      'inbox/paper/CryoFastAR.md',
      '</current_note>',
    ].join('\n');

    expect(extractUserQuery(persisted)).toBe('Summarize this paper');
  });

  it('strips API-only external_contexts from restored user text', () => {
    const withAvailability = [
      '本地文件都已经补齐内容了吗？',
      '',
      '<external_contexts>',
      '  <context path="/Users/example/Projects" available="true" />',
      '</external_contexts>',
    ].join('\n');
    expect(extractUserQuery(withAvailability)).toBe('本地文件都已经补齐内容了吗？');
    expect(extractUserQuery([
      '',
      '<external_contexts>',
      '  <context path="/Users/example/Projects" available="true" />',
      '</external_contexts>',
    ].join('\n'))).toBe('');
  });
});

describe('resolveUserMessageDisplayText', () => {
  it('prefers saved displayContent over persisted XML', () => {
    expect(resolveUserMessageDisplayText({
      displayContent: 'hello',
      content: '<current_note>\nnotes/a.md\n</current_note>',
    })).toBe('hello');
  });

  it('falls back to extractUserQuery when displayContent is missing', () => {
    expect(resolveUserMessageDisplayText({
      content: 'hello\n\n<current_note>\nnotes/a.md\n</current_note>',
    })).toBe('hello');
  });

  it('honors empty displayContent without falling back to XML', () => {
    expect(resolveUserMessageDisplayText({
      displayContent: '',
      content: '<current_note>\nnotes/a.md\n</current_note>',
    })).toBe('');
  });

  it('strips leaked external_contexts from polluted displayContent overlays', () => {
    expect(resolveUserMessageDisplayText({
      displayContent: [
        '继续',
        '',
        '<external_contexts>',
        '  <context path="/Users/example/repo" available="true" />',
        '</external_contexts>',
      ].join('\n'),
      content: '继续',
    })).toBe('继续');
  });
});
