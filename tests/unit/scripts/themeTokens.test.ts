import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const rootDir = process.cwd();
const styleDir = join(rootDir, 'packages', 'pivi-react', 'styles');

/** Legacy product tokens and semantic literals closed by spec 037 WS-05. */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: '--pivi-brand', pattern: /--pivi-brand\b/ },
  { label: '--pivi-brand-rgb', pattern: /--pivi-brand-rgb\b/ },
  { label: '--pivi-error', pattern: /--pivi-error\b/ },
  { label: '--pivi-error-rgb', pattern: /--pivi-error-rgb\b/ },
  { label: '--pivi-compact', pattern: /--pivi-compact\b/ },
  { label: '#7abaff', pattern: /#7abaff\b/i },
  { label: '#f472b6', pattern: /#f472b6\b/i },
  { label: '#d45d5d', pattern: /#d45d5d\b/i },
  { label: '#E57373', pattern: /#e57373\b/i },
  { label: '#1B365D', pattern: /#1b365d\b/i },
  { label: '#dc3545', pattern: /#dc3545\b/i },
  { label: '#5bc0de', pattern: /#5bc0de\b/i },
];

function listCssFiles(dir: string, baseDir = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listCssFiles(path, baseDir);
    return entry.isFile() && entry.name.endsWith('.css')
      ? [relative(baseDir, path).split('\\').join('/')]
      : [];
  });
}

function findForbiddenThemeTokens(css: string): string[] {
  return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(css)).map(
    ({ label }) => label,
  );
}

describe('pivi-react theme token closure', () => {
  it('does not use legacy semantic literals or product color tokens in style modules', () => {
    const violations: string[] = [];

    for (const relativePath of listCssFiles(styleDir)) {
      const absolutePath = join(styleDir, relativePath);
      const css = readFileSync(absolutePath, 'utf8');
      const matches = findForbiddenThemeTokens(css);

      for (const match of matches) {
        violations.push(`${relativePath}: ${match}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('flags fixture CSS that still uses forbidden legacy theme literals', () => {
    const fixture = `
      .pivi-example {
        color: #7abaff;
        border-color: var(--pivi-brand);
      }
    `;

    expect(findForbiddenThemeTokens(fixture)).toEqual(
      expect.arrayContaining(['--pivi-brand', '#7abaff']),
    );
  });
});
