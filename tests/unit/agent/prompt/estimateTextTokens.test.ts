import {
  estimateTextTokens,
  looksStructured,
} from '@pivi/agent/prompt';

describe('estimateTextTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('estimates ASCII prose at four characters per token', () => {
    expect(estimateTextTokens('a'.repeat(120))).toBeGreaterThanOrEqual(30);
  });

  it('charges CJK per code point', () => {
    expect(estimateTextTokens('知识管理系统'.repeat(20))).toBe(120);
  });

  it('uses the denser structured ratio for fenced or JSON text', () => {
    expect(looksStructured('```\ncode\n```')).toBe(true);
    expect(looksStructured('{"ok":true}')).toBe(true);
    expect(looksStructured('plain prose')).toBe(false);
    const prose = estimateTextTokens('a'.repeat(120));
    const fenced = estimateTextTokens(`${'a'.repeat(120)}\n\`\`\`\ncode\n\`\`\``);
    expect(fenced).toBeGreaterThan(prose);
  });
});
