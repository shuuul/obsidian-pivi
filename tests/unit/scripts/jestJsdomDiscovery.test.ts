import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

function collectTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return /\.test\.tsx?$/.test(entry.name) ? [resolve(path)] : [];
  });
}

describe('Jest jsdom project discovery', () => {
  it('discovers every jsdom test exactly once', () => {
    const rootDir = process.cwd();
    const testDir = join(rootDir, 'tests/jsdom');
    const expected = collectTests(testDir).sort();

    const output = execFileSync(
      process.execPath,
      [
        'scripts/run-jest.js',
        '--listTests',
        '--selectProjects',
        'jsdom',
        '--runInBand',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );
    const discovered = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.endsWith('.test.ts') || line.endsWith('.test.tsx'))
      .map(file => resolve(file))
      .sort();

    expect(discovered).toEqual(expected);
    expect(new Set(discovered).size).toBe(discovered.length);
    expect(discovered.length).toBeGreaterThan(0);
  });
});
