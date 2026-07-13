import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

describe('Jest React project discovery', () => {
  it('discovers every test in the renamed obsidian-react directory', () => {
    const rootDir = process.cwd();
    const testDir = join(rootDir, 'tests/obsidian-react');
    const expected = readdirSync(testDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
      .map(entry => resolve(testDir, entry.name))
      .sort();

    const output = execFileSync(
      process.execPath,
      [
        'scripts/run-jest.js',
        '--listTests',
        '--selectProjects',
        'obsidian-react',
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
    expect(discovered.length).toBeGreaterThan(0);
  });
});
