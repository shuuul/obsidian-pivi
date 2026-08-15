import { existsSync, readFileSync } from 'fs';

import { getOfficialObsidianConfigPath, isOfficialObsidianCliEnabled } from '@pivi/obsidian-host';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('os', () => ({
  homedir: () => '/Users/tester',
}));

const mockedExistsSync = jest.mocked(existsSync);
const mockedReadFileSync = jest.mocked(readFileSync);
const originalPlatform = process.platform;

describe('official Obsidian CLI detection', () => {
  beforeEach(() => {
    mockedExistsSync.mockReset();
    mockedReadFileSync.mockReset();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses the global Obsidian config path on macOS', () => {
    expect(getOfficialObsidianConfigPath()).toBe(
      '/Users/tester/Library/Application Support/obsidian/obsidian.json',
    );
  });

  it('uses the roaming AppData path on Windows', () => {
    const originalAppData = process.env.APPDATA;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = 'C:\\Users\\tester\\AppData\\Roaming';
    try {
      expect(getOfficialObsidianConfigPath()).toBe(
        'C:\\Users\\tester\\AppData\\Roaming\\obsidian\\obsidian.json',
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      if (originalAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = originalAppData;
    }
  });

  it('returns true only when the global cli flag is true', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{"cli":true}');

    expect(isOfficialObsidianCliEnabled()).toBe(true);

    mockedReadFileSync.mockReturnValue('{"cli":false}');
    expect(isOfficialObsidianCliEnabled()).toBe(false);
  });

  it('returns false when config is missing or invalid', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(isOfficialObsidianCliEnabled()).toBe(false);

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{bad json');
    expect(isOfficialObsidianCliEnabled()).toBe(false);
  });
});
