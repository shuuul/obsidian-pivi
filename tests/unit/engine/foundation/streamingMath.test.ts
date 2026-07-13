import {
  escapeMathDelimitersForStreaming,
  hasStreamingMathDelimiters,
} from '@pivi/pivi-agent-core/foundation/streamingMath';

describe('streaming math escaping', () => {
  it('escapes math delimiters but preserves already escaped dollars and inline code', () => {
    expect(escapeMathDelimitersForStreaming('Value $x$ and \\$literal')).toBe(
      'Value \\$x\\$ and \\$literal',
    );
    expect(escapeMathDelimitersForStreaming('`$code$` and $math$')).toBe(
      '`$code$` and \\$math\\$',
    );
  });

  it('preserves backtick and tilde fenced code while escaping following text', () => {
    expect(escapeMathDelimitersForStreaming('```math\n$x$\n```\nafter $y$')).toBe(
      '```math\n$x$\n```\nafter \\$y\\$',
    );
    expect(escapeMathDelimitersForStreaming('~~~text\n$x$\n~~~\nafter $y$')).toBe(
      '~~~text\n$x$\n~~~\nafter \\$y\\$',
    );
  });

  it('keeps the remainder of an unclosed fence untouched', () => {
    expect(escapeMathDelimitersForStreaming('before $x$\n```\n$unfinished')).toBe(
      'before \\$x\\$\n```\n$unfinished',
    );
  });

  it('reports only delimiters that would be escaped', () => {
    expect(hasStreamingMathDelimiters('plain text')).toBe(false);
    expect(hasStreamingMathDelimiters('`$code$`')).toBe(false);
    expect(hasStreamingMathDelimiters('$math$')).toBe(true);
  });
});
