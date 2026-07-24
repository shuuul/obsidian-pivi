import { createRequire } from 'node:module';
import { join } from 'node:path';

const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const {
  buildReleaseManifest,
  buildStableVersionMetadata,
  isPrereleaseVersion,
  replaceReadmeVersionBadge,
} = nodeRequire('./scripts/versionMetadata');

describe('versionMetadata', () => {
  const readme = [
    '# Pivi',
    '',
    '![version](https://img.shields.io/static/v1?label=version&message=0.16.2&color=blue)',
    '',
  ].join('\n');

  it('detects semver prerelease versions', () => {
    expect(isPrereleaseVersion('0.17.0-beta.0')).toBe(true);
    expect(isPrereleaseVersion('0.16.2')).toBe(false);
  });

  it('replaces the README version badge', () => {
    expect(replaceReadmeVersionBadge(readme, '0.17.0')).toContain('message=0.17.0');
  });

  it('builds stable metadata from package.json', () => {
    const synced = buildStableVersionMetadata({
      packageJson: { version: '0.17.0' },
      manifestJson: { version: '0.16.2', minAppVersion: '1.12.0' },
      versionsJson: { '0.16.2': '1.12.0' },
      readme,
    });

    expect(synced.manifestJson.version).toBe('0.17.0');
    expect(synced.versionsJson['0.17.0']).toBe('1.12.0');
    expect(synced.readme).toContain('message=0.17.0');
  });

  it('builds release manifest assets from the stable root template', () => {
    expect(
      buildReleaseManifest({
        manifestJson: {
          id: 'pivi',
          version: '0.16.2',
          minAppVersion: '1.12.0',
        },
        packageVersion: '0.17.0-beta.1',
      }),
    ).toEqual({
      id: 'pivi',
      version: '0.17.0-beta.1',
      minAppVersion: '1.12.0',
    });
  });
});
