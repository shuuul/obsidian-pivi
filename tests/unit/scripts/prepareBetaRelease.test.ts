import { createRequire } from 'node:module';
import { join } from 'node:path';

const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const {
  assertAllowedBranch,
  parseArgs,
  prepareBetaVersion,
  resolveNextBetaVersion,
} = nodeRequire('./scripts/prepare-beta-release');

describe('prepare-beta-release', () => {
  it('rejects main branch', () => {
    expect(() => {
      prepareBetaVersion({
        branch: 'main',
        currentVersion: '0.16.2',
        stableVersion: '0.16.2',
      });
    }).toThrow('prepare-beta-release must run on next or beta');
  });

  it('creates the first beta from the stable release manifest', () => {
    expect(
      prepareBetaVersion({
        branch: 'next',
        currentVersion: '0.16.2',
        stableVersion: '0.16.2',
      }),
    ).toBe('0.17.0-beta.0');
  });

  it('increments an existing beta prerelease', () => {
    expect(
      resolveNextBetaVersion(undefined, '0.17.0-beta.0', '0.16.2'),
    ).toBe('0.17.0-beta.1');
  });

  it('honors --base for the first beta of a target line', () => {
    expect(
      prepareBetaVersion({
        base: '0.18.0',
        branch: 'beta',
        currentVersion: '0.16.2',
        stableVersion: '0.16.2',
      }),
    ).toBe('0.18.0-beta.0');
  });

  it('parses --base from argv', () => {
    expect(parseArgs(['node', 'prepare-beta-release.js', '--base', '0.18.0'])).toEqual({
      base: '0.18.0',
    });
  });

  it('allows next and beta branches', () => {
    expect(() => assertAllowedBranch('next')).not.toThrow();
    expect(() => assertAllowedBranch('beta')).not.toThrow();
  });
});
