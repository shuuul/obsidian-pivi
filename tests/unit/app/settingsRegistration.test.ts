jest.mock('@/app/ui/PiviSettingTabHost', () => ({
  PiviSettingTabHost: jest.fn(),
}));
jest.mock('@/ui/shared/utils/obsidianPrivateApi', () => ({
  openNativeSettingsPage: jest.fn(() => true),
}));

import type { App } from 'obsidian';

import { navigateSlashBadge } from '@/app/hostPlatform';
import { registerPiviSettings } from '@/app/settingsRegistration';
import { PiviSettingTabHost } from '@/app/ui/PiviSettingTabHost';
import { openNativeSettingsPage } from '@/ui/shared/utils/obsidianPrivateApi';

describe('registerPiviSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([['command', 'Commands'], ['skill', 'Skills']])('routes a %s badge to %s and unregisters on unload', async (kind, title) => {
    const app = {} as App;
    const cleanups: Array<() => void> = [];
    const plugin = { app, addSettingTab: jest.fn(), register: (cleanup: () => void) => cleanups.push(cleanup) };
    const listDropdownEntries = jest.fn(async () => [{ kind, name: 'review' }]);
    const workspace = { ensureWorkspaceServices: async () => ({ slashCommandCatalog: { listDropdownEntries } }) };
    registerPiviSettings(plugin as never, {} as never, workspace as never);
    await navigateSlashBadge(app, 'review');
    expect(openNativeSettingsPage).toHaveBeenCalledWith(app, 'pivi', title);
    cleanups.forEach(cleanup => cleanup());
    await navigateSlashBadge(app, 'review');
    expect(openNativeSettingsPage).toHaveBeenCalledTimes(1);
  });

  it('injects the shared asynchronous workspace readiness callback', async () => {
    const firstWorkspace = { id: 'first' };
    const secondWorkspace = { id: 'second' };
    const ensureWorkspaceServices = jest.fn(async () => firstWorkspace);
    const addSettingTab = jest.fn();
    const plugin = {
      app: { id: 'app' },
      addSettingTab,
      register: jest.fn(),
      ensureWorkspaceServices,
    };
    const settings = { boundary: 'settings' };
    const workspace = { ensureWorkspaceServices };

    registerPiviSettings(plugin as never, settings as never, workspace as never);

    expect(PiviSettingTabHost).toHaveBeenCalledTimes(1);
    const getWorkspace = jest.mocked(PiviSettingTabHost).mock.calls[0]?.[3];
    expect(getWorkspace).toEqual(expect.any(Function));
    expect(ensureWorkspaceServices).not.toHaveBeenCalled();
    await expect(getWorkspace?.()).resolves.toBe(firstWorkspace);

    ensureWorkspaceServices.mockResolvedValue(secondWorkspace);
    await expect(getWorkspace?.()).resolves.toBe(secondWorkspace);
    expect(addSettingTab).toHaveBeenCalledTimes(1);
  });
});
