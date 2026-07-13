import type { MountedSurface, MountChatViewOptions } from '@pivi/obsidian-react/mount';
import { mountChatView } from '@pivi/obsidian-react/mount';
import type { AppTabManagerState } from '@pivi/obsidian-host/bootstrap/types';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Scope } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';

import type {
  PiviChatViewHandle,
  PiviPluginWorkspace,
} from '@/app/hostContracts';
import { createChatUiPorts } from '@/app/ui/createUiPorts';
import { createImperativeChatAdapter } from '@/app/ui/imperativeChatAdapter';
import { PiviViewHost } from '@/app/ui/PiviViewHost';

jest.mock('@pivi/obsidian-react/mount', () => ({
  mountChatView: jest.fn(),
}));

jest.mock('@/app/i18n', () => ({
  appI18n: { locale: 'en' },
}));

jest.mock('@/app/ui/createUiPorts', () => ({
  createChatUiPorts: jest.fn(),
}));

jest.mock('@/app/ui/imperativeChatAdapter', () => ({
  createImperativeChatAdapter: jest.fn(),
}));

type TestEventRef = { event: string; source: 'vault' | 'workspace' };
type TestScope = {
  parent?: unknown;
  handlers: Array<{
    key: string | null;
    func: (event: KeyboardEvent) => false | unknown;
  }>;
};

const scopeMock = Scope as unknown as { instances: TestScope[] };

function createHandle(): PiviChatViewHandle {
  return {
    commands: {
      getState: jest.fn(() => ({
        mounted: true,
        canCreateTab: true,
        canStartNewSession: true,
        canCloseActiveTab: true,
      })),
      createTab: jest.fn(async () => true),
      startNewSession: jest.fn(async () => true),
      closeActiveTab: jest.fn(async () => true),
      cancelActiveTurn: jest.fn(() => true),
      addEditorSelection: jest.fn(() => true),
      getInlineEditModel: jest.fn(() => null),
      getActiveExternalContexts: jest.fn(() => []),
    },
    maintenance: {
      persistState: jest.fn(async () => undefined),
      resetSession: jest.fn(async () => undefined),
      getBoundSessionFiles: jest.fn(() => []),
      hasSession: jest.fn(() => false),
      activateSession: jest.fn(async () => false),
      refreshModelPresentation: jest.fn(),
      refreshRuntimePrompt: jest.fn(async () => undefined),
      reloadMcpServers: jest.fn(async () => undefined),
      refreshVaultSkills: jest.fn(async () => undefined),
      invalidateSlashCatalog: jest.fn(),
      warmSlashCatalog: jest.fn(),
      syncExternalReadDirectories: jest.fn(),
      applyEnvironmentRuntimeChange: jest.fn(async () => ({ failedTabs: 0 })),
      markFileContextDirty: jest.fn(),
      handleFileOpen: jest.fn(),
      dismissMentionDropdown: jest.fn(),
    },
  };
}

function createHarness() {
  const vaultOn = jest.fn((event: string, _callback: (...args: unknown[]) => void) => (
    { event, source: 'vault' } as TestEventRef
  ));
  const workspaceOn = jest.fn((event: string, _callback: (...args: unknown[]) => void) => (
    { event, source: 'workspace' } as TestEventRef
  ));
  const plugin = {
    app: {
      scope: { id: 'app-scope' },
      vault: {
        offref: jest.fn(),
        on: vaultOn,
      },
      workspace: {
        on: workspaceOn,
      },
    },
    settings: { tabBarPosition: 'header' },
    getUiFacades: jest.fn(() => ({
      chatUIConfig: {
        getChatIcon: jest.fn(() => ({ kind: 'pivi-brand' })),
      },
    })),
    getAllViews: jest.fn(() => []),
    loadTabManagerState: jest.fn(async () => null),
    persistTabManagerState: jest.fn(async () => undefined),
  };
  const workspace = { id: 'workspace' } as unknown as PiviPluginWorkspace;
  const getWorkspace = jest.fn(() => workspace);
  const ports = { runtime: {} } as unknown as ChatPorts;
  const handle = createHandle();
  const adapter = {
    prepareShell: jest.fn(() => ({
      store: { id: 'store' },
      activeChat: { id: 'active-chat' },
      inputPortalContainer: document.createElement('div'),
    })),
    getShellActions: jest.fn(() => ({ id: 'shell-actions' })),
    getSurfaceActions: jest.fn(() => ({ id: 'surface-actions' })),
    getWelcomeQuoteAdapter: jest.fn(() => ({ id: 'welcome-adapter' })),
    getViewHandle: jest.fn(() => handle),
    mount: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  };
  jest.mocked(createChatUiPorts).mockReturnValue(ports);
  jest.mocked(createImperativeChatAdapter).mockReturnValue(adapter as never);

  const leaf = { id: 'leaf' } as unknown as WorkspaceLeaf;
  const contentEl = document.createElement('section');
  const containerEl = document.createElement('div');
  containerEl.append(document.createElement('header'), contentEl);

  const view = new PiviViewHost(leaf, plugin as never, getWorkspace);
  const registerEvent = jest.fn();
  const registerDomEvent = jest.fn();
  Object.assign(view, {
    app: plugin.app,
    containerEl,
    contentEl,
    registerDomEvent,
    registerEvent,
  });

  return {
    adapter,
    containerEl,
    contentEl,
    getWorkspace,
    handle,
    leaf,
    plugin,
    ports,
    registerDomEvent,
    registerEvent,
    view,
    workspace,
    workspaceOn,
    vaultOn,
  };
}

async function installSuccessfulSurfaceMount(): Promise<jest.MockedFunction<MountedSurface['dispose']>> {
  const dispose = jest.fn(async () => undefined);
  jest.mocked(mountChatView).mockImplementation(async (options) => {
    const adapterContainer = options.ownerDocument.createElement('div');
    options.container.append(adapterContainer);
    await options.imperativeAdapter.mount(adapterContainer, {
      ownerDocument: options.ownerDocument,
      ownerWindow: options.ownerWindow,
      portalContainer: options.portalContainer,
    });
    let disposed = false;
    dispose.mockImplementation(async () => {
      if (disposed) return;
      disposed = true;
      await options.imperativeAdapter.dispose();
    });
    return { dispose };
  });
  return dispose;
}

describe('PiviViewHost shell lifecycle', () => {
  beforeAll(() => {
    Object.defineProperty(PiviViewHost.prototype, 'load', {
      configurable: true,
      value: jest.fn(async () => undefined),
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.instances = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('captures ports in app wiring and mounts a port-free React surface', async () => {
    const surfaceDispose = await installSuccessfulSurfaceMount();
    const harness = createHarness();

    await harness.view.onOpen();

    expect(createChatUiPorts).toHaveBeenCalledWith(harness.plugin, harness.workspace);
    expect(harness.getWorkspace).toHaveBeenCalledTimes(1);
    expect(createImperativeChatAdapter).toHaveBeenCalledWith(expect.objectContaining({
      plugin: harness.plugin,
      view: harness.view,
      chatIcon: { kind: 'pivi-brand' },
      getContainerEl: expect.any(Function),
      persistTabState: expect.any(Function),
      persistTabStateImmediate: expect.any(Function),
      loadPersistedTabState: expect.any(Function),
      activateOpenSessionElsewhere: expect.any(Function),
    }));

    const options = jest.mocked(mountChatView).mock.calls[0]?.[0] as MountChatViewOptions;
    expect(options).toEqual(expect.objectContaining({
      container: harness.contentEl,
      ownerDocument: document,
      ownerWindow: window,
      portalContainer: document.body,
      chatShell: expect.objectContaining({
        store: { id: 'store' },
        activeChat: { id: 'active-chat' },
        actions: { id: 'shell-actions' },
        surfaceActions: { id: 'surface-actions' },
        welcomeQuoteAdapter: { id: 'welcome-adapter' },
      }),
    }));
    expect(options).not.toHaveProperty('ports');
    expect(harness.adapter.mount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ ownerDocument: document, ownerWindow: window }),
      harness.ports,
    );
    expect(harness.view.getChatHandle()).toBe(harness.handle);
    expect(surfaceDispose).not.toHaveBeenCalled();

    expect(harness.vaultOn.mock.calls.map(([event]) => event)).toEqual([
      'create',
      'delete',
      'rename',
      'modify',
    ]);
    expect(harness.workspaceOn).toHaveBeenCalledWith('file-open', expect.any(Function));
    expect(harness.registerEvent).toHaveBeenCalledTimes(5);
    expect(harness.registerDomEvent).toHaveBeenCalledWith(
      document,
      'click',
      expect.any(Function),
    );

    const createCallback = harness.vaultOn.mock.calls[0]?.[1] as (() => void) | undefined;
    const modifyCallback = harness.vaultOn.mock.calls[3]?.[1] as (() => void) | undefined;
    createCallback?.();
    modifyCallback?.();
    expect(harness.handle.maintenance.markFileContextDirty).toHaveBeenNthCalledWith(1, true);
    expect(harness.handle.maintenance.markFileContextDirty).toHaveBeenNthCalledWith(2, false);

    const file = { path: 'note.md' };
    const fileOpenCallback = harness.workspaceOn.mock.calls[0]?.[1] as (
      (openedFile: unknown) => void
    ) | undefined;
    fileOpenCallback?.(file);
    expect(harness.handle.maintenance.handleFileOpen).toHaveBeenCalledWith(file);

    const target = document.createElement('button');
    const clickCallback = harness.registerDomEvent.mock.calls[0]?.[2] as (
      (event: Event) => void
    ) | undefined;
    clickCallback?.({ target } as unknown as Event);
    expect(harness.handle.maintenance.dismissMentionDropdown).toHaveBeenCalledWith(target);

    const scope = scopeMock.instances.at(-1);
    expect(scope?.parent).toBe(harness.plugin.app.scope);
    const escape = scope?.handlers.find(({ key }) => key === 'Escape');
    expect(escape?.func(new KeyboardEvent('keydown'))).toBe(false);
    expect(harness.handle.commands.cancelActiveTurn).toHaveBeenCalledTimes(1);
  });

  it('disposes once, cancels debounced persistence, and persists through the semantic handle', async () => {
    jest.useFakeTimers();
    const surfaceDispose = await installSuccessfulSurfaceMount();
    const harness = createHarness();
    await harness.view.onOpen();

    const adapterDeps = jest.mocked(createImperativeChatAdapter).mock.calls[0]?.[0];
    const state = { openTabs: [], activeTabId: null } as AppTabManagerState;
    adapterDeps?.persistTabState(state);

    await harness.view.onClose();
    jest.advanceTimersByTime(300);

    expect(surfaceDispose).toHaveBeenCalledTimes(1);
    expect(harness.handle.maintenance.persistState).toHaveBeenCalledTimes(1);
    expect(harness.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(harness.plugin.persistTabManagerState).not.toHaveBeenCalled();
    expect(harness.view.getChatHandle()).toBeNull();
    expect(harness.view.scope).toBeNull();

    await harness.view.onClose();
    expect(surfaceDispose).toHaveBeenCalledTimes(1);
    expect(harness.handle.maintenance.persistState).toHaveBeenCalledTimes(1);
    expect(harness.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans up the prepared imperative adapter when the React surface fails to mount', async () => {
    const mountError = new Error('React surface mount failed');
    jest.mocked(mountChatView).mockRejectedValue(mountError);
    const harness = createHarness();

    await expect(harness.view.onOpen()).rejects.toBe(mountError);

    expect(harness.handle.maintenance.persistState).toHaveBeenCalledTimes(1);
    expect(harness.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(harness.view.getChatHandle()).toBeNull();
    expect(harness.view.scope).toBeNull();
    await harness.view.onClose();
    expect(harness.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it('still releases the adapter and preserves both errors when mount-failure persistence fails', async () => {
    const mountError = new Error('React surface mount failed');
    const persistenceError = new Error('Immediate persistence failed');
    jest.mocked(mountChatView).mockRejectedValue(mountError);
    const harness = createHarness();
    jest.mocked(harness.handle.maintenance.persistState).mockRejectedValue(persistenceError);

    let thrown: unknown;
    try {
      await harness.view.onOpen();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([mountError, persistenceError]);
    expect(harness.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(harness.view.getChatHandle()).toBeNull();
    expect(harness.view.scope).toBeNull();
  });
});
