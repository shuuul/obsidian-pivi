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

  it('recognizes fenced and JSON text', () => {
    expect(looksStructured('```\ncode\n```')).toBe(true);
    expect(looksStructured('{"ok":true}')).toBe(true);
    expect(looksStructured('plain prose')).toBe(false);
  });

  // Recorded once with js-tiktoken's o200k_base encoding; the tokenizer is
  // deliberately not a production or test dependency.
  const fencedJson = `\`\`\`json
${JSON.stringify({
    nodes: Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}-a1b2c3d4e5f6`,
      type: 'text',
      x: index * 120,
      y: index * 80,
      width: 320,
      height: 180,
      text: `Knowledge item ${index}`,
    })),
  }, null, 2)}
\`\`\`
`;
  const corpus: Array<[string, string, number]> = [
    ['English Markdown with fence', `# Release checklist

The plugin keeps provider usage authoritative while retaining a lightweight local fallback. Review the changes, run focused tests, and verify that public exports remain stable.

\`\`\`ts
const remaining = Math.max(0, contextWindow - reservedOutput);
return { remaining, shouldCompact: remaining < trigger };
\`\`\`

- No tokenizer is bundled.
- Fenced code is estimated independently from prose.`, 79],
    ['TypeScript', `export interface ContextBudget {
  contextWindow: number;
  reservedOutput: number;
  messages: readonly string[];
}

export function remainingTokens(budget: ContextBudget): number {
  const used = budget.messages.reduce((total, message) => total + estimateTextTokens(message), 0);
  return Math.max(0, budget.contextWindow - budget.reservedOutput - used);
}`, 78],
    ['JSON', `{"provider":"openai","model":"gpt-4.1","usage":{"input_tokens":128450,"output_tokens":2048},"features":["tools","vision","reasoning"],"enabled":true,"metadata":{"session":"alpha-2026-09-02","retries":0}}`, 61],
    ['zh-CN JSON', `{"语言":"简体中文","标题":"上下文预算报告","统计":{"输入令牌":128450,"输出令牌":2048,"剩余比例":0.3475},"功能":["工具调用","图片理解","会话恢复"],"已启用":true}`, 58],
    ['Chinese', '知识管理系统需要在长会话中准确估算上下文。提供商返回的用量应当作为权威数据，本地算法只在缺少统计时提供稳定、轻量且保守的回退值。分段处理代码与普通文字，可以避免一小段代码影响整篇文档。', 68],
    ['Japanese', '知識管理システムでは、長い会話のコンテキストを正確に見積もる必要があります。プロバイダーが返す使用量を優先し、統計がない場合だけ軽量な推定値を利用します。コードと通常の文章を分けて処理すると、文書全体の誤差を抑えられます。', 87],
    ['digit-dense Markdown table', `| Date | Requests | Input tokens | Output tokens | Cost USD | Success |
|---:|---:|---:|---:|---:|---:|
| 2026-08-28 | 128,450 | 18,992,341 | 842,119 | 1,284.73 | 99.82% |
| 2026-08-29 | 131,008 | 19,450,772 | 901,337 | 1,319.05 | 99.76% |
| 2026-08-30 | 127,993 | 18,775,004 | 799,481 | 1,251.66 | 99.91% |
| 2026-08-31 | 140,221 | 21,008,915 | 955,204 | 1,427.39 | 99.68% |`, 191],
    ['pretty-printed fenced JSON', fencedJson, 857],
  ];

  it.each(corpus)('keeps %s within 25%% of its o200k reference', (_name, text, reference) => {
    const estimate = estimateTextTokens(text);
    expect(estimate).toBeGreaterThanOrEqual(Math.ceil(reference * 0.75));
    expect(estimate).toBeLessThanOrEqual(Math.floor(reference * 1.25));
  });
});
