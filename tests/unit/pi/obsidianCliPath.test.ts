import { resolveObsidianCliBinary } from '@pivi/obsidian-host';

jest.mock('fs', () => ({
  accessSync: jest.fn(),
  constants: { X_OK: 1 },
}));

jest.mock('obsidian', () => ({
  Platform: { isMacOS: true, isLinux: false, isWin: false },
}));

const { accessSync } = jest.requireMock('fs') as { accessSync: jest.Mock };

describe('resolveObsidianCliBinary', () => {
  beforeEach(() => {
    accessSync.mockReset();
    delete process.env.OBSIDIAN_CLI_PATH;
  });

  it('prefers configured cliPath', () => {
    expect(resolveObsidianCliBinary('/custom/obsidian-cli')).toBe('/custom/obsidian-cli');
    expect(accessSync).not.toHaveBeenCalled();
  });

  it('uses OBSIDIAN_CLI_PATH env when set', () => {
    process.env.OBSIDIAN_CLI_PATH = '/env/obsidian';
    expect(resolveObsidianCliBinary(null)).toBe('/env/obsidian');
  });

  it('returns first executable macOS candidate', () => {
    accessSync.mockImplementation((path: string) => {
      if (path === '/opt/homebrew/bin/obsidian') {
        return;
      }
      throw new Error('missing');
    });
    expect(resolveObsidianCliBinary(null)).toBe('/opt/homebrew/bin/obsidian');
  });

  it('falls back to obsidian on PATH when no candidate is executable', () => {
    accessSync.mockImplementation(() => {
      throw new Error('missing');
    });
    expect(resolveObsidianCliBinary(null)).toBe('obsidian');
  });
});
