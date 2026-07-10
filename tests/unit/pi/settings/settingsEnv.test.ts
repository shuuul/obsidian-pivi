import {
  formatContextLimit,
  parseEnvironmentVariables,
} from '@pivi/pivi-agent-core/foundation/settingsEnv';

describe('parseEnvironmentVariables', () => {
  it('ignores blank lines and comment lines', () => {
    const input = `
# API keys below
   # indented comment

FOO=bar
`;
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar' });
  });

  it('parses plain KEY=value assignments', () => {
    expect(parseEnvironmentVariables('ANTHROPIC_API_KEY=sk-test')).toEqual({
      ANTHROPIC_API_KEY: 'sk-test',
    });
  });

  it('strips export prefix', () => {
    expect(parseEnvironmentVariables('export OPENAI_API_KEY=oa-key')).toEqual({
      OPENAI_API_KEY: 'oa-key',
    });
  });

  it('strips matching double and single quotes around values', () => {
    expect(
      parseEnvironmentVariables(
        'A="double quoted"\nB=\'single quoted\'\nC=unquoted',
      ),
    ).toEqual({
      A: 'double quoted',
      B: 'single quoted',
      C: 'unquoted',
    });
  });

  it('last duplicate key wins', () => {
    expect(parseEnvironmentVariables('KEY=first\nKEY=second')).toEqual({
      KEY: 'second',
    });
  });

  it('ignores malformed lines without a valid key=value pair', () => {
    expect(
      parseEnvironmentVariables('=noval\nnoequals\nKEY=ok\n=after'),
    ).toEqual({ KEY: 'ok' });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnvironmentVariables('X=1\r\nY=2')).toEqual({ X: '1', Y: '2' });
  });
});

describe('formatContextLimit', () => {
  it.each([
    { tokens: 1_000_000, expected: '1M' },
    { tokens: 1_048_576, expected: '1M' },
    { tokens: 2_000_000, expected: '2M' },
    { tokens: 2_000, expected: '2K' },
    { tokens: 4_096, expected: '4K' },
    { tokens: 8_192, expected: '8K' },
    { tokens: 128_000, expected: '128K' },
    { tokens: 131_072, expected: '128K' },
  ])('formats $tokens tokens as $expected', ({ tokens, expected }) => {
    expect(formatContextLimit(tokens)).toBe(expected);
  });

  it('uses one decimal place for non-standard context limits', () => {
    expect(formatContextLimit(1234)).toBe('1.2K');
  });
});
