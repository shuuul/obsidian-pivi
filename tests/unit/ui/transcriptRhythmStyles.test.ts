import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');

describe('transcript rhythm styles', () => {
  const markdown = readFileSync(
    join(stylesRoot, 'components/markdown-content.css'),
    'utf8',
  );
  const messages = readFileSync(
    join(stylesRoot, 'components/messages.css'),
    'utf8',
  );

  it('uses semantic flow tokens between transcript content blocks', () => {
    expect(messages).toMatch(
      /\.pivi-text-block\+\.pivi-tool-call\s*\{[^}]*margin-top:\s*var\(--pivi-flow-content\);/s,
    );
    expect(messages).toMatch(
      /\.pivi-tool-call\+\.pivi-text-block\s*\{[^}]*margin-top:\s*var\(--pivi-flow-content\);/s,
    );
    expect(messages).not.toMatch(
      /\.pivi-message-assistant \.pivi-message-content p\s*\{/,
    );
  });

  it('isolates shared message output from inherited editor text layout', () => {
    const contentRule = messages.match(/\.pivi-message-content\s*\{([^}]*)\}/)?.[1] ?? '';
    const streamingTailRule = messages.match(/\.pivi-streaming-markdown-tail\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(contentRule).toMatch(/white-space:\s*normal;/);
    expect(contentRule).toMatch(/word-break:\s*normal;/);
    expect(contentRule).toMatch(/line-break:\s*auto;/);
    expect(contentRule).toMatch(/tab-size:\s*8;/);
    expect(contentRule).toMatch(/caret-color:\s*auto;/);
    expect(streamingTailRule).toMatch(/white-space:\s*pre-wrap;/);
  });

  it('separates narrative blocks while keeping headings attached to their section', () => {
    expect(markdown).toContain(
      '.pivi-message-assistant .pivi-message-content .pivi-markdown-rendered',
    );
    expect(markdown).toContain(
      '.pivi-inline-edit-diff-review-content.pivi-markdown-rendered',
    );
    expect(markdown).not.toContain('.pivi-inline-edit-diff-review-deletion');
    expect(markdown).not.toContain('.pivi-inline-edit-surface-reply-content');
    expect(markdown).toContain(
      '--pivi-markdown-flow-content: var(--pivi-flow-content);',
    );
    expect(markdown).toContain(
      '--pivi-markdown-flow-section: var(--pivi-flow-section);',
    );
    expect(markdown).toMatch(
      /\+ :is\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*margin-block-start:\s*var\(--pivi-markdown-flow-section\);/s,
    );
    expect(markdown).toMatch(
      /> :is\(h1, h2, h3, h4, h5, h6\) \+ :is\([^}]*margin-block-start:\s*var\(--pivi-markdown-flow-compact\);/s,
    );
  });

  it('leaves shared transcript list item geometry to the host theme', () => {
    expect(markdown).not.toMatch(
      /:is\(ul, ol\) > li\s*\{[^}]*margin:/s,
    );
    expect(markdown).not.toMatch(
      /:is\(ul, ol\) > li \+ li\s*\{/s,
    );
    expect(markdown).not.toMatch(
      /li > :is\(ul, ol\)\s*\{/s,
    );
  });
});
