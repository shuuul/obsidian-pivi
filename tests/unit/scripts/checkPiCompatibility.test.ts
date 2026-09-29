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
      deepImports?: string[];
      id?: string;
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

  it('rejects unmanifested and stale Pi deep imports', () => {
    const { fixture, manifest, manifestTarget } = createFixture();
    try {
      const oauthEntry = manifest.entries.find(entry => entry.id === 'pi-ai-bundled-oauth-deep-imports');
      if (!oauthEntry) throw new Error('Compatibility fixture has no OAuth deep-import entry');
      oauthEntry.deepImports = ['@earendil-works/pi-ai/dist/auth/oauth/anthropic.js'];
      writeFileSync(manifestTarget, JSON.stringify(manifest));
      writeFileSync(
        join(fixture, 'packages/engine-pi/src/auth/registerPiviBundledOAuthFlowLoaders.ts'),
        "import { anthropicOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/anthropic.js';\n",
      );
      const unlisted = join(fixture, 'packages/engine-pi/src/auth/unlisted.ts');
      writeFileSync(unlisted, "import { xaiOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/xai.js';\n");

      const result = spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Unmanifested Pi deep import outside the upstream export map: @earendil-works/pi-ai/dist/auth/oauth/xai.js (packages/engine-pi/src/auth/unlisted.ts)',
      );
      expect(result.stderr).not.toContain('anthropic.js is no longer imported');

      rmSync(unlisted);
      writeFileSync(join(fixture, 'packages/engine-pi/src/auth/registerPiviBundledOAuthFlowLoaders.ts'), '');
      const stale = spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
      expect(stale.stderr).toContain(
        'pi-ai-bundled-oauth-deep-imports: manifested deep import @earendil-works/pi-ai/dist/auth/oauth/anthropic.js is no longer imported',
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('verifies installed deep-import targets and their declared named exports', () => {
    const { fixture, manifest, manifestTarget } = createFixture();
    try {
      const oauthEntry = manifest.entries.find(entry => entry.id === 'pi-ai-bundled-oauth-deep-imports');
      if (!oauthEntry) throw new Error('Compatibility fixture has no OAuth deep-import entry');
      oauthEntry.deepImports = [
        '@earendil-works/pi-ai/dist/auth/oauth/anthropic.js',
        '@earendil-works/pi-ai/dist/auth/oauth/moved.js',
      ];
      writeFileSync(manifestTarget, JSON.stringify(manifest));
      writeFileSync(
        join(fixture, 'packages/engine-pi/src/auth/registerPiviBundledOAuthFlowLoaders.ts'),
        [
          "import { anthropicOAuth, type OAuthRenamed } from '@earendil-works/pi-ai/dist/auth/oauth/anthropic.js';",
          "import { movedOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/moved.js';",
          "import { completeSimple } from '@earendil-works/pi-ai/compat';",
          '',
        ].join('\n'),
      );
      const packageDir = join(fixture, 'node_modules/@earendil-works/pi-ai');
      mkdirSync(join(packageDir, 'dist/auth/oauth'), { recursive: true });
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        exports: { '.': './dist/index.js', './compat': './dist/compat.js' },
      }));
      writeFileSync(join(packageDir, 'dist/auth/oauth/anthropic.js'), '');
      writeFileSync(
        join(packageDir, 'dist/auth/oauth/anthropic.d.ts'),
        'export declare const anthropicOAuth: unknown;\n',
      );

      const result = spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Pi deep import @earendil-works/pi-ai/dist/auth/oauth/anthropic.js no longer declares export OAuthRenamed',
      );
      expect(result.stderr).not.toContain('declares export anthropicOAuth');
      expect(result.stderr).toContain(
        'Pi deep import target is missing from the installed package: @earendil-works/pi-ai/dist/auth/oauth/moved.js',
      );
      expect(result.stderr).not.toContain('@earendil-works/pi-ai/compat');
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
