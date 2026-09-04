import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const checker = join(rootDir, 'scripts', 'check-pi-compatibility.mjs');

function createFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'pivi-pi-compat-'));
  const manifest = JSON.parse(readFileSync(
    join(rootDir, 'packages/engine-pi/compatibility-manifest.json'),
    'utf8',
  )) as {
    entries: Array<{
      implementationPaths: string[];
      verificationTests: string[];
      [key: string]: unknown;
    }>;
  };
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({
    dependencies: { '@earendil-works/pi-agent-core': '0.84.4' },
  }));
  const manifestTarget = join(fixture, 'packages/engine-pi/compatibility-manifest.json');
  mkdirSync(dirname(manifestTarget), { recursive: true });
  writeFileSync(manifestTarget, JSON.stringify(manifest));
  for (const entry of manifest.entries) {
    for (const relativePath of [...entry.implementationPaths, ...entry.verificationTests]) {
      const target = join(fixture, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
  }
  return { fixture, manifest, manifestTarget };
}

describe('check-pi-compatibility', () => {
  it('passes for the repository manifest', () => {
    const output = execFileSync(process.execPath, [checker], { cwd: rootDir, encoding: 'utf8' });
    expect(output).toContain('complete and aligned');
  });

  it('rejects missing lifecycle metadata and omitted known compatibility paths', () => {
    const { fixture, manifest, manifestTarget } = createFixture();
    try {
      const first = manifest.entries[0];
      if (!first) throw new Error('Compatibility fixture has no entries');
      first.reason = '';
      for (const entry of manifest.entries) {
        entry.implementationPaths = entry.implementationPaths
          .filter(relativePath => relativePath !== 'build/plugins/shim-pi-ai.mjs');
      }
      writeFileSync(manifestTarget, JSON.stringify(manifest));
      const result = spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('reason must be non-empty');
      expect(result.stderr).toContain('Known compatibility path is not manifested');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('selects the newest synchronized stable version above the exact pin', () => {
    const canaryScriptUrl = pathToFileURL(
      join(rootDir, 'scripts/prepare-pi-canary.mjs'),
    ).href;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { selectNextSynchronizedVersion } from ${JSON.stringify(canaryScriptUrl)};
       process.stdout.write(selectNextSynchronizedVersion('0.84.4', [
         ['0.84.4', '0.85.0', '0.86.0-beta.1', '0.86.0'],
         ['0.84.4', '0.85.0', '0.86.0'],
         ['0.84.4', '0.85.0'],
       ]));`,
    ], { cwd: rootDir, encoding: 'utf8' });
    expect(output).toBe('0.85.0');
  });
});
