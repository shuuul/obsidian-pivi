jest.mock('@/app/commandRegistration', () => ({ registerPiviCommands: jest.fn() }));
jest.mock('@/app/settingsRegistration', () => ({ registerPiviSettings: jest.fn() }));
jest.mock('@/app/viewRegistration', () => ({ registerPiviViews: jest.fn() }));

import { registerPiviCommands } from '@/app/commandRegistration';
import { initializePiviPlugin } from '@/app/pluginLifecycle';
import { registerPiviSettings } from '@/app/settingsRegistration';
import { registerPiviViews } from '@/app/viewRegistration';

describe('initializePiviPlugin', () => {
  it('registers surfaces before layout-ready workspace initialization', async () => {
    let onLayoutReady: (() => void) | null = null;
    const neverReady = new Promise<never>(() => undefined);
    const plugin = {
      app: {
        workspace: {
          onLayoutReady: jest.fn((callback: () => void) => {
            onLayoutReady = callback;
          }),
        },
      },
      loadSettings: jest.fn(async () => undefined),
      ensureWorkspaceServices: jest.fn(() => neverReady),
    };

    await initializePiviPlugin(plugin as never);

    expect(registerPiviViews).toHaveBeenCalledWith(plugin);
    expect(registerPiviCommands).toHaveBeenCalledWith(plugin);
    expect(registerPiviSettings).toHaveBeenCalledWith(plugin);
    expect(plugin.ensureWorkspaceServices).not.toHaveBeenCalled();

    expect(onLayoutReady).not.toBeNull();
    (onLayoutReady as unknown as () => void)();
    expect(plugin.ensureWorkspaceServices).toHaveBeenCalledTimes(1);
  });
});
