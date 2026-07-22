import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('response metadata styles', () => {
  it('shares duration typography with the live agent status', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/messages.css'),
      'utf8',
    );

    expect(styles).toMatch(/\.pivi-response-meta\s*\{[\s\S]*?font-family:\s*inherit;/);
    expect(styles).toMatch(/\.pivi-response-meta\s*\{[\s\S]*?font-size:\s*var\(--pivi-text-sm\);/);
    expect(styles).toMatch(/\.pivi-response-meta\s*\{[\s\S]*?font-weight:\s*500;/);
    expect(styles).toMatch(/\.pivi-response-meta\s*\{[\s\S]*?font-style:\s*italic;/);
  });

  it('aligns the live agent status with assistant message content', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/thinking.css'),
      'utf8',
    );

    expect(styles).toMatch(/\.pivi-thinking\s*\{[\s\S]*?padding-inline:\s*14px;/);
    expect(styles).toMatch(/\.pivi-thinking\s*\{[\s\S]*?color:\s*var\(--pivi-host-text-muted\);/);
    expect(styles).not.toMatch(/pivi-thinking-pulse/);
  });

  it('keeps the inline elapsed result at the left edge without redefining metadata typography', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/features/inline-edit-surface.css'),
      'utf8',
    );
    const progressRule = styles.match(/\.pivi-inline-edit-surface-progress\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(progressRule).toMatch(/display:\s*none;/);
    expect(progressRule).toMatch(/margin-inline-end:\s*auto;/);
    expect(progressRule).toMatch(/color:\s*var\(--pivi-host-text-muted\);/);
    expect(progressRule).not.toMatch(/font-(family|size|style|weight):/);
    expect(styles).toMatch(
      /\.pivi-inline-edit-surface-progress--visible\s*\{[^}]*display:\s*inline;/s,
    );
    expect(styles).not.toMatch(
      /\.pivi-inline-edit-surface--waiting \.pivi-inline-edit-surface-progress\s*\{/,
    );
  });
});
