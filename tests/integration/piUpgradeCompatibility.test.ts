import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertPiSessionManagerPrivateCapabilities,
  PI_SESSION_MANAGER_PRIVATE_CAPABILITIES,
  rewritePersistedSessionManager,
} from '@pivi/pivi-agent-core/engine/pi/session/piSessionManagerPrivateAdapter';
import { VERSION } from '@pivi/pivi-agent-core/engine/pi/shims/piCodingAgentConfig';

/**
 * Focused gate that must stay green before bumping the exact Pi pin.
 * Covers pin invariants, private-capability assertions, and documents the
 * real SessionManager append compatibility suite as a required sibling.
 */
describe('Pi upgrade compatibility gate', () => {
  const rootDir = process.cwd();

  it('keeps exact synchronized Pi pins across manifests and the lockfile', () => {
    const result = spawnSync(process.execPath, [join(rootDir, 'scripts', 'check-pi-pins.mjs')], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('exact and synchronized');
  });

  it('documents the three Pi packages at one exact version in package manifests', () => {
    const root = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const core = JSON.parse(
      readFileSync(join(rootDir, 'packages', 'pivi-agent-core', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const names = [
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
    ] as const;
    const version = root.dependencies[names[0]];
    if (typeof version !== 'string') {
      throw new Error('missing root pi-agent-core pin');
    }
    expect(version).toBe(VERSION);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version.startsWith('^') || version.startsWith('~')).toBe(false);
    for (const name of names) {
      expect(root.dependencies[name]).toBe(version);
      expect(core.dependencies[name]).toBe(version);
    }
  });

  it.each(PI_SESSION_MANAGER_PRIVATE_CAPABILITIES)(
    'rejects a fake SessionManager missing %s before rewrite mutation',
    (capability) => {
      const rewrite = jest.fn();
      const manager: Record<string, unknown> = {
        fileEntries: [{ type: 'session', id: 's1' }],
        flushed: false,
        _rewriteFile: rewrite,
        _buildIndex: jest.fn(),
      };
      if (capability === 'fileEntries' || capability === 'flushed') {
        delete manager[capability];
      } else {
        manager[capability] = undefined;
      }
      expect(() => rewritePersistedSessionManager(manager)).toThrow(capability);
      expect(() => rewritePersistedSessionManager(manager)).toThrow(VERSION);
      expect(() => assertPiSessionManagerPrivateCapabilities(manager, 'upgrade gate'))
        .toThrow(/test:pi-compat/);
      expect(rewrite).not.toHaveBeenCalled();
    },
  );

  it('requires the real SessionManager append compatibility suite to remain present', () => {
    const suite = readFileSync(
      join(rootDir, 'tests/integration/piSessionAppendCompatibility.test.ts'),
      'utf8',
    );
    expect(suite).toContain('preserves prior bytes and round-trips through the installed SessionManager');
    expect(suite).toContain('_rewriteFile');
    expect(suite).toContain('flushed = true');
  });
});
