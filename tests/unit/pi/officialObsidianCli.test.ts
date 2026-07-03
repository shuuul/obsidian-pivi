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
