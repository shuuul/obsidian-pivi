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
    { tokens: 1_000_000, expected: '1m' },
    { tokens: 2_000_000, expected: '2m' },
    { tokens: 2_000, expected: '2k' },
    { tokens: 128_000, expected: '128k' },
  ])('formats $tokens tokens as $expected', ({ tokens, expected }) => {
    expect(formatContextLimit(tokens)).toBe(expected);
  });

  it('uses locale string for values that are not exact k or m multiples', () => {
    expect(formatContextLimit(1234)).toBe((1234).toLocaleString());
  });
});