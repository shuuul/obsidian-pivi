jest.mock('@/app/commandRegistration', () => ({ registerPiviCommands: jest.fn() }));
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
    const facades = {
      chat: { boundary: 'chat' },
      sessions: { boundary: 'sessions' },
      workspace: { boundary: 'workspace', ensureWorkspaceServices: jest.fn(() => neverReady) },
      integrations: {
        boundary: 'integrations',
        settings: {
          editorSelectionToolbar: { enabled: true, shortcuts: [{ enabled: true }] },
        },
      },
      settings: { boundary: 'settings' },
    };

    await initializePiviPlugin(plugin as never, facades as never, loadSettings);

    expect(registerPiviViews).toHaveBeenCalledWith(
      plugin, facades.chat, facades.sessions, facades.workspace,
    );
    expect(registerPiviCommands).toHaveBeenCalledWith(plugin, facades.chat);
    expect(registerPiviSettings).toHaveBeenCalledWith(
      plugin, facades.settings, facades.workspace,
    );
    expect(registerEditorSelectionToolbar).toHaveBeenCalledWith(plugin, {
      isToolbarEnabled: expect.any(Function),
      shouldYieldToNoteToolbar: expect.any(Function),
    });
    expect(registerSelectionToolbarUi).toHaveBeenCalledWith(
      facades.integrations,
      expect.any(Function),
    );
    expect(facades.workspace.ensureWorkspaceServices).not.toHaveBeenCalled();

    const toolbarOptions = (registerEditorSelectionToolbar as jest.Mock).mock.calls[0]?.[1] as {
      isToolbarEnabled: () => boolean;
    };
    facades.integrations.settings = {
      editorSelectionToolbar: { enabled: true, shortcuts: [{ enabled: false }, { enabled: false }] },
    };
    expect(toolbarOptions.isToolbarEnabled()).toBe(false);

    expect(onLayoutReady).not.toBeNull();
    (onLayoutReady as unknown as () => void)();
    expect(facades.workspace.ensureWorkspaceServices).toHaveBeenCalledTimes(1);
  });
});
