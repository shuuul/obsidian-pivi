import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('check-pi-pins', () => {
  it('passes for the repository exact Pi pins', () => {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts', 'check-pi-pins.mjs')],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('exact and synchronized');
  });

  it('fails when a caret range is introduced in a temporary copy of root package.json', () => {
    // Structural guard: the checker rejects non-exact declared versions.
    const script = readFileSync(join(process.cwd(), 'scripts', 'check-pi-pins.mjs'), 'utf8');
    expect(script).toContain('must pin');
    expect(script).toContain('isExactVersion');
    expect(script).toContain('@earendil-works/pi-coding-agent');
  });
});
