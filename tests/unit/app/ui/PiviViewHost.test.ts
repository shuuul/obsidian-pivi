import type { MountedSurface, MountChatViewOptions } from '@pivi/pivi-react/mount';
import { mountChatView } from '@pivi/pivi-react/mount';
import type { WorkspaceLeaf } from 'obsidian';

import type { PiviPluginWorkspace } from '@/app/hostContracts';
import { createChatUiPorts } from '@/app/ui/createUiPorts';
import { createImperativeChatAdapter } from '@/app/ui/imperativeChatAdapter';
import { PiviViewHost } from '@/app/ui/PiviViewHost';

jest.mock('@pivi/pivi-react/mount', () => ({
  mountChatView: jest.fn(),
}));

jest.mock('@/app/i18n', () => ({
  appI18n: { locale: 'en', t: (key: string) => key },
}));

jest.mock('@/app/ui/createUiPorts', () => ({
  createChatUiPorts: jest.fn(),
}));

jest.mock('@/app/ui/imperativeChatAdapter', () => ({
  createImperativeChatAdapter: jest.fn(),
}));

describe('PiviViewHost mount lifecycle', () => {
  beforeAll(() => {
    Object.defineProperty(PiviViewHost.prototype, 'load', {
      configurable: true,
      value: jest.fn(async () => undefined),
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disposes a surface that resolves after the view closes', async () => {
    let resolveMount!: (surface: MountedSurface) => void;
    let mountOptions!: MountChatViewOptions;
    jest.mocked(mountChatView).mockImplementation((options) => new Promise((resolve) => {
      mountOptions = options;
      resolveMount = resolve;
    }));

    const ownerWindow = {} as Window;
    const ownerDocument = {
      body: {},
      defaultView: ownerWindow,
    } as unknown as Document;
    const container = {
      createDiv: jest.fn(() => ({})),
      empty: jest.fn(),
      ownerDocument,
    } as unknown as HTMLElement;
    const containerEl = { children: [{}, container] } as unknown as HTMLElement;
    const plugin = {
      app: {
        scope: {},
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      getChatPerfRecorder: jest.fn(() => ({})),
      getUiFacades: jest.fn(() => ({ chatUIConfig: {} })),
      loadTabManagerState: jest.fn(async () => null),
      persistTabManagerState: jest.fn(async () => undefined),
    };
    const adapter = {
      dispose: jest.fn(async () => undefined),
      getShellActions: jest.fn(() => ({})),
      getSurfaceActions: jest.fn(() => ({})),
      getViewHandle: jest.fn(() => ({
        maintenance: { persistState: jest.fn(async () => undefined) },
      })),
      getWelcomeQuoteAdapter: jest.fn(() => ({})),
      mount: jest.fn(async () => undefined),
      prepareShell: jest.fn(() => ({
        activeChat: {},
        inputPortalContainer: {},
        store: {},
      })),
    };
    const workspace = {} as PiviPluginWorkspace;
    const ports = {} as ReturnType<typeof createChatUiPorts>;
    jest.mocked(createChatUiPorts).mockReturnValue(ports);
    jest.mocked(createImperativeChatAdapter).mockReturnValue(adapter as never);
    const view = new PiviViewHost(
      { id: 'leaf' } as unknown as WorkspaceLeaf,
      plugin as never,
      plugin as never,
      jest.fn(async () => workspace),
    );
    Object.assign(view, {
      app: plugin.app,
      containerEl,
      contentEl: container,
      registerDomEvent: jest.fn(),
      registerEvent: jest.fn(),
    });

    const opening = view.onOpen();
    await Promise.resolve();
    await Promise.resolve();
    expect(mountChatView).toHaveBeenCalledTimes(1);

    await view.onClose();
    await mountOptions.imperativeAdapter.mount(
      { empty: jest.fn() } as unknown as HTMLElement,
      { ownerDocument, ownerWindow, portalContainer: ownerDocument.body },
    );
    expect((view as unknown as { registerEvent: jest.Mock }).registerEvent).not.toHaveBeenCalled();

    const secondHandle = {
      maintenance: { persistState: jest.fn(async () => undefined) },
    };
    const secondAdapter = {
      ...adapter,
      dispose: jest.fn(async () => undefined),
      getViewHandle: jest.fn(() => secondHandle),
    };
    const liveSurface: MountedSurface = {
      dispose: jest.fn(async () => undefined),
    };
    jest.mocked(createImperativeChatAdapter).mockReturnValue(secondAdapter as never);
    jest.mocked(mountChatView).mockResolvedValue(liveSurface);
    const reopening = view.onOpen();
    await reopening;
    expect(view.getChatHandle()).toBe(secondHandle);

    const staleSurface: MountedSurface = {
      dispose: jest.fn(async () => undefined),
    };
    resolveMount(staleSurface);
    await opening;

    expect(staleSurface.dispose).toHaveBeenCalledTimes(1);
    expect(view.getChatHandle()).toBe(secondHandle);

    await view.onClose();
    expect(liveSurface.dispose).toHaveBeenCalledTimes(1);
  });
});
