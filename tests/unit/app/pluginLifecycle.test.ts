jest.mock('@/app/commandRegistration', () => ({ registerPiviCommands: jest.fn() }));
jest.mock('@/app/cliRegistration', () => ({ registerPiviCli: jest.fn() }));
jest.mock('@/app/settingsRegistration', () => ({ registerPiviSettings: jest.fn() }));
jest.mock('@/app/viewRegistration', () => ({ registerPiviViews: jest.fn() }));
jest.mock('@/app/editorSelectionToolbarRegistration', () => ({
  registerEditorSelectionToolbar: jest.fn(),
}));
jest.mock('@/app/noteToolbarIntegration', () => ({
  isNoteToolbarTextToolbarActive: jest.fn(() => false),
}));
jest.mock('@/app/ui/selectionToolbar/SelectionToolbarSurfaceController', () => ({
  registerSelectionToolbarUi: jest.fn(),
}));

import { registerPiviCommands } from '@/app/commandRegistration';
import { registerPiviCli } from '@/app/cliRegistration';
import { registerEditorSelectionToolbar } from '@/app/editorSelectionToolbarRegistration';
import { initializePiviPlugin } from '@/app/pluginLifecycle';
import { registerPiviSettings } from '@/app/settingsRegistration';
import { registerSelectionToolbarUi } from '@/app/ui/selectionToolbar/SelectionToolbarSurfaceController';
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
      register: jest.fn(),
    };
    const loadSettings = jest.fn(async () => undefined);
    const application = {
      boundary: 'application',
      ensureWorkspaceServices: jest.fn(() => neverReady),
      settings: {
        editorSelectionToolbar: { enabled: true, shortcuts: [{ enabled: true }] },
      },
    };
    const sessions = { boundary: 'sessions' };

    await initializePiviPlugin(plugin as never, application as never, sessions as never, loadSettings);

    expect(registerPiviViews).toHaveBeenCalledWith(plugin, application, sessions);
    expect(registerPiviCommands).toHaveBeenCalledWith(plugin, application);
    expect(registerPiviCli).toHaveBeenCalledWith(plugin, {
      readNote: expect.any(Function),
      listWorkspaceEntries: expect.any(Function),
      createAuxQueryRunner: expect.any(Function),
      getDefaultModel: expect.any(Function),
      today: expect.any(Function),
    });
    expect(registerPiviSettings).toHaveBeenCalledWith(plugin, application, application);
    expect(registerEditorSelectionToolbar).toHaveBeenCalledWith(plugin, {
      isToolbarEnabled: expect.any(Function),
      shouldYieldToNoteToolbar: expect.any(Function),
    });
    expect(registerSelectionToolbarUi).toHaveBeenCalledWith(
      application,
      expect.any(Function),
    );
    expect(application.ensureWorkspaceServices).not.toHaveBeenCalled();

    const toolbarOptions = (registerEditorSelectionToolbar as jest.Mock).mock.calls[0]?.[1] as {
      isToolbarEnabled: () => boolean;
    };
    application.settings = {
      editorSelectionToolbar: { enabled: true, shortcuts: [{ enabled: false }, { enabled: false }] },
    };
    expect(toolbarOptions.isToolbarEnabled()).toBe(false);

    expect(onLayoutReady).not.toBeNull();
    (onLayoutReady as unknown as () => void)();
    expect(application.ensureWorkspaceServices).toHaveBeenCalledTimes(1);
  });
});
