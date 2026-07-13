jest.mock('@/app/ui/PiviSettingTabHost', () => ({
  PiviSettingTabHost: jest.fn(),
}));

import { registerPiviSettings } from '@/app/settingsRegistration';
import { PiviSettingTabHost } from '@/app/ui/PiviSettingTabHost';

describe('registerPiviSettings', () => {
  it('injects the shared asynchronous workspace readiness callback', async () => {
    const firstWorkspace = { id: 'first' };
    const secondWorkspace = { id: 'second' };
    const ensureWorkspaceServices = jest.fn(async () => firstWorkspace);
    const addSettingTab = jest.fn();
    const plugin = {
      app: { id: 'app' },
      addSettingTab,
      ensureWorkspaceServices,
    };

    registerPiviSettings(plugin as never);

    expect(PiviSettingTabHost).toHaveBeenCalledTimes(1);
    const getWorkspace = jest.mocked(PiviSettingTabHost).mock.calls[0]?.[2];
    expect(getWorkspace).toEqual(expect.any(Function));
    expect(ensureWorkspaceServices).not.toHaveBeenCalled();
    await expect(getWorkspace?.()).resolves.toBe(firstWorkspace);

    ensureWorkspaceServices.mockResolvedValue(secondWorkspace);
    await expect(getWorkspace?.()).resolves.toBe(secondWorkspace);
    expect(addSettingTab).toHaveBeenCalledTimes(1);
  });
});
