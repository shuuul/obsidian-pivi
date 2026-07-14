import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const rootDir = process.cwd();

describe('bundle size gate', () => {
  it('passes when main.js is below the 5 MB Obsidian limit', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pivi-bundle-size-'));
    const bundle = join(tempDir, 'main.js');
    writeFileSync(bundle, Buffer.alloc(1024, 0));

    const output = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import { checkBundleSizeAtPath } from './scripts/check-bundle-size.mjs';
checkBundleSizeAtPath(${JSON.stringify(bundle)});`,
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );

    expect(output).toContain('main.js size:');
    expect(output).toContain('Obsidian limit headroom:');
  });

  it('fails when the bundle exceeds the configured ceiling', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pivi-bundle-size-'));
    const oversizedBundle = join(tempDir, 'main.js');
    writeFileSync(oversizedBundle, Buffer.alloc(5 * 1024 * 1024 + 1, 0));

    expect(() => {
      execFileSync(
        'node',
        [
          '--input-type=module',
          '-e',
          `import { checkBundleSizeAtPath } from './scripts/check-bundle-size.mjs';
checkBundleSizeAtPath(${JSON.stringify(oversizedBundle)});`,
        ],
        { cwd: rootDir, encoding: 'utf8' },
      );
    }).toThrow();
  });
});
