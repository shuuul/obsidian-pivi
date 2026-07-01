import {
  asciiDoubleQuotesToCurly,
  buildOldStringNotFoundMessage,
  curlyDoubleQuotesToAscii,
  detectOldStringMismatchHint,
} from '../../../../src/pi/tools/vaultEditMatch';

describe('vaultEditMatch', () => {
  it('maps ASCII quotes to alternating curly pairs', () => {
    expect(asciiDoubleQuotesToCurly('say "弱关系" here')).toBe('say “弱关系” here');
  });

  it('maps curly quotes to ASCII', () => {
    expect(curlyDoubleQuotesToAscii('say “弱关系” here')).toBe('say "弱关系" here');
  });

  it('detects ASCII old_string against curly vault text', () => {
    const content = '松散的联系“弱关系”理论';
    const hint = detectOldStringMismatchHint(content, '松散的联系"弱关系"理论');
    expect(hint?.code).toBe('ascii_vs_curly_quotes');
    expect(hint?.message).toContain('curly quotes');
  });

  it('buildOldStringNotFoundMessage includes quote hint when applicable', () => {
    const content = '来自联系松散的“弱关系”。';
    const msg = buildOldStringNotFoundMessage('note.md', content, '来自联系松散的"弱关系"。');
    expect(msg).toContain('old_string not found in note.md');
    expect(msg).toContain('curly quotes');
  });

  it('buildOldStringNotFoundMessage stays generic without a known mismatch', () => {
    const msg = buildOldStringNotFoundMessage('note.md', 'hello', 'missing');
    expect(msg).toContain('obsidian_read');
    expect(msg).not.toContain('curly quotes');
  });
});
