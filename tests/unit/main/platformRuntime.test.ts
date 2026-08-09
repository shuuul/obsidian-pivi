const desktopOnload = jest.fn(async () => undefined);
const desktopOnunload = jest.fn();
const mobileOnload = jest.fn(async () => undefined);
const mobileOnunload = jest.fn();
const createDesktopRuntime = jest.fn(async () => ({
  onload: desktopOnload,
  onunload: desktopOnunload,
}));
const createMobileRuntime = jest.fn(() => ({
  onload: mobileOnload,
  onunload: mobileOnunload,
}));
const resolvePiviPlatformCapabilities = jest.fn();

jest.mock('@/app/platformCapabilities', () => ({
  resolvePiviPlatformCapabilities,
}));
jest.mock('@/app/composition/desktop/bootstrap', () => ({
  createDesktopRuntime,
}));
jest.mock('@/app/composition/mobile/bootstrap', () => ({
  createMobileRuntime,
}));

import { Plugin } from 'obsidian';

import PiviPlugin from '@/main';

function createPlugin(): PiviPlugin {
  return new PiviPlugin({} as never, {
    id: 'pivi',
    name: 'Pivi',
    version: '0.0.0',
  } as never);
}

describe('platform runtime shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads only the desktop runtime on desktop', async () => {
    const capabilities = { platform: 'desktop' };
    resolvePiviPlatformCapabilities.mockReturnValue(capabilities);
    const plugin = createPlugin();

    await plugin.onload();
    plugin.onunload();

    expect(createDesktopRuntime).toHaveBeenCalledWith(plugin, capabilities);
    expect(createMobileRuntime).not.toHaveBeenCalled();
    expect(desktopOnload).toHaveBeenCalledTimes(1);
    expect(desktopOnunload).toHaveBeenCalledTimes(1);
  });

  it('loads only the Mobile-safe runtime on Mobile', async () => {
    const capabilities = { platform: 'mobile' };
    resolvePiviPlatformCapabilities.mockReturnValue(capabilities);
    const plugin = createPlugin();

    await plugin.onload();
    plugin.onunload();

    expect(createMobileRuntime).toHaveBeenCalledWith(plugin, capabilities);
    expect(createDesktopRuntime).not.toHaveBeenCalled();
    expect(mobileOnload).toHaveBeenCalledTimes(1);
    expect(mobileOnunload).toHaveBeenCalledTimes(1);
  });

  it('does not start a runtime whose deferred bootstrap resolves after unload', async () => {
    const capabilities = { platform: 'desktop' };
    resolvePiviPlatformCapabilities.mockReturnValue(capabilities);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    createDesktopRuntime.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return { onload: desktopOnload, onunload: desktopOnunload };
    });
    const plugin = createPlugin();

    const loading = plugin.onload();
    await started;
    plugin.onunload();
    release();
    await loading;

    expect(desktopOnload).not.toHaveBeenCalled();
    expect(desktopOnunload).toHaveBeenCalledTimes(1);
  });

  it('remains an Obsidian Plugin class', () => {
    expect(createPlugin()).toBeInstanceOf(Plugin);
  });
});
