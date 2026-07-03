import { ObsidianAuthContext } from '@pivi/pivi-agent-core/engine/pi/PiProviderCredentialStore';
import { createMockPiviPluginStub, asPiviPlugin } from '../../../helpers/mockPiviPlugin';

describe('ObsidianAuthContext.env', () => {
  it('prefers pi agent environment over shared and injected process env', async () => {
    const plugin = asPiviPlugin(
      createMockPiviPluginStub({
        settings: {
          sharedEnvironmentVariables: 'MY_VAR=shared',
          agentSettings: {
            environmentVariables: 'MY_VAR=pi-agent',
            selectedMode: 'default',
            visibleModels: [],
          },
        },
      }),
    );
    const getEnvironmentVariable = jest.fn().mockReturnValue('external');
    const ctx = new ObsidianAuthContext(plugin, { getEnvironmentVariable });

    await expect(ctx.env('MY_VAR')).resolves.toBe('pi-agent');
    expect(getEnvironmentVariable).not.toHaveBeenCalled();
  });

  it('falls back to shared environment when pi agent env omits the key', async () => {
    const plugin = asPiviPlugin(
      createMockPiviPluginStub({
        settings: {
          sharedEnvironmentVariables: 'SHARED_ONLY=from-shared',
          agentSettings: {
            environmentVariables: 'OTHER=1',
            selectedMode: 'default',
            visibleModels: [],
          },
        },
      }),
    );
    const getEnvironmentVariable = jest.fn().mockReturnValue('external');
    const ctx = new ObsidianAuthContext(plugin, { getEnvironmentVariable });

    await expect(ctx.env('SHARED_ONLY')).resolves.toBe('from-shared');
    expect(getEnvironmentVariable).not.toHaveBeenCalled();
  });

  it('uses injected getEnvironmentVariable when pi and shared lack the key', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const getEnvironmentVariable = jest.fn((name: string) =>
      name === 'INJECTED_KEY' ? 'from-injection' : undefined,
    );
    const ctx = new ObsidianAuthContext(plugin, { getEnvironmentVariable });

    await expect(ctx.env('INJECTED_KEY')).resolves.toBe('from-injection');
    expect(getEnvironmentVariable).toHaveBeenCalledWith('INJECTED_KEY');
  });

  it('returns undefined when the key is absent at every layer', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const getEnvironmentVariable = jest.fn().mockReturnValue(undefined);
    const ctx = new ObsidianAuthContext(plugin, { getEnvironmentVariable });

    await expect(ctx.env('MISSING_KEY')).resolves.toBeUndefined();
  });
});

describe('ObsidianAuthContext.fileExists', () => {
  it('expands ~/ using injected getHomeDirectory before calling fileExists', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const fileExists = jest.fn((path: string) => path === '/mock-home/.config/creds');
    const getHomeDirectory = jest.fn().mockReturnValue('/mock-home');
    const ctx = new ObsidianAuthContext(plugin, { fileExists, getHomeDirectory });

    await expect(ctx.fileExists('~/.config/creds')).resolves.toBe(true);

    expect(getHomeDirectory).toHaveBeenCalled();
    expect(fileExists).toHaveBeenCalledWith('/mock-home/.config/creds');
  });

  it('passes absolute paths through without home expansion', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const fileExists = jest.fn().mockReturnValue(true);
    const getHomeDirectory = jest.fn();
    const ctx = new ObsidianAuthContext(plugin, { fileExists, getHomeDirectory });

    await expect(ctx.fileExists('/etc/hosts')).resolves.toBe(true);

    expect(getHomeDirectory).not.toHaveBeenCalled();
    expect(fileExists).toHaveBeenCalledWith('/etc/hosts');
  });

  it('resolves false when fileExists throws', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const fileExists = jest.fn(() => {
      throw new Error('fs unavailable');
    });
    const ctx = new ObsidianAuthContext(plugin, {
      getHomeDirectory: () => '/home',
      fileExists,
    });

    await expect(ctx.fileExists('~/secret')).resolves.toBe(false);
  });

  it('resolves false for empty expanded path without calling fileExists', async () => {
    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const fileExists = jest.fn();
    const ctx = new ObsidianAuthContext(plugin, {
      getHomeDirectory: () => '',
      fileExists,
    });

    await expect(ctx.fileExists('')).resolves.toBe(false);
    expect(fileExists).not.toHaveBeenCalled();
  });
});