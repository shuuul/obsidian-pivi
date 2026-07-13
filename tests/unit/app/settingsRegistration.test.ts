jest.mock('@/app/ui/PiviSettingTabHost', () => ({
  PiviSettingTabHost: jest.fn(),
}));

import { registerPiviSettings } from '@/app/settingsRegistration';
import { PiviSettingTabHost } from '@/app/ui/PiviSettingTabHost';

describe('registerPiviSettings', () => {
  it('injects a lazy workspace callback into the settings host', () => {
    const firstWorkspace = { id: 'first' };
    const secondWorkspace = { id: 'second' };
    const getPiWorkspace = jest.fn(() => firstWorkspace);
    const addSettingTab = jest.fn();
    const plugin = {
      app: { id: 'app' },
      addSettingTab,
      getPiWorkspace,
    };

    registerPiviSettings(plugin as never);

    expect(PiviSettingTabHost).toHaveBeenCalledTimes(1);
    const getWorkspace = jest.mocked(PiviSettingTabHost).mock.calls[0]?.[2];
    expect(getWorkspace).toEqual(expect.any(Function));
    expect(getPiWorkspace).not.toHaveBeenCalled();
    expect(getWorkspace?.()).toBe(firstWorkspace);

    getPiWorkspace.mockReturnValue(secondWorkspace);
    expect(getWorkspace?.()).toBe(secondWorkspace);
    expect(addSettingTab).toHaveBeenCalledTimes(1);
  });
});
