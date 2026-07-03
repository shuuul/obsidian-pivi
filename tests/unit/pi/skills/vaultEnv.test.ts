import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  findNpxExecutable,
  formatNpxNotFoundError,
  getSpawnEnvWithEnhancedPath,
} from '@pivi/pivi-agent-core/skills/vault/env';

describe('vault skills environment helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-vault-env-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds the containing app bundle binary path on macOS', () => {
    const spawnEnv = getSpawnEnvWithEnhancedPath(
      undefined,
      { HOME: tempDir, PATH: '' },
      {
        execPath: '/Applications/Obsidian.app/Contents/MacOS/Obsidian',
        homeDir: tempDir,
        platform: 'darwin',
      },
    );

    expect(spawnEnv.PATH?.split(':')).toContain('/Applications/Obsidian.app/Contents/MacOS');
  });

  it('uses Windows separators and mirrors PATH into Path', () => {
    const spawnEnv = getSpawnEnvWithEnhancedPath(
      'C:\\Tools',
      {
        APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming',
        HOME: 'C:\\Users\\Ada',
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
        PATH: 'C:\\Existing',
      },
      {
        execPath: 'C:\\Program Files\\Obsidian\\Obsidian.exe',
        homeDir: 'C:\\Users\\Ada',
        platform: 'win32',
      },
    );

    expect(spawnEnv.PATH?.split(';')).toEqual(
      expect.arrayContaining(['C:\\Tools', 'C:\\Existing']),
    );
    expect(spawnEnv.Path).toBe(spawnEnv.PATH);
  });

  it('uses platform-specific npx executable names', () => {
    const binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node.exe'), '');
    const npxPath = path.join(binDir, 'npx.cmd');
    fs.writeFileSync(npxPath, '');

    expect(
      findNpxExecutable(
        undefined,
        { HOME: tempDir, PATH: binDir },
        { execPath: path.join(tempDir, 'Obsidian.exe'), homeDir: tempDir, platform: 'win32' },
      ),
    ).toBe(npxPath);
  });

  it('uses injected home directory when expanding PATH entries', () => {
    const binDir = path.join(tempDir, 'node-bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');

    expect(
      formatNpxNotFoundError(
        { PATH: '~/node-bin' },
        { homeDir: tempDir, platform: 'linux' },
      ),
    ).toContain(`Found node in ${binDir} but not npx alongside it.`);
  });
});
