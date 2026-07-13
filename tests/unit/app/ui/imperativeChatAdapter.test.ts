import {
  ChatUiStore,
  createInitialChatUiSnapshot,
  type ChatTabSnapshotItem,
} from '@pivi/obsidian-react/store';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { Editor, MarkdownView } from 'obsidian';

import type { PiviChatCompositionHost } from '@/app/hostContracts';
import { createImperativeChatAdapter } from '@/app/ui/imperativeChatAdapter';
import { TabManager } from '@/ui/chat/tabs/TabManager';
import type {
  PersistedTabManagerState,
  TabManagerCallbacks,
} from '@/ui/chat/tabs/types';

jest.mock('@/ui/chat/tabs/TabManager', () => ({
  TabManager: jest.fn(),
}));

type TestService = {
  getAuxiliaryModel?: jest.Mock<string | null, []>;
  syncSystemPrompt?: jest.Mock<Promise<void>, []>;
  reloadMcpServers: jest.Mock<Promise<void>, []>;
  syncSession: jest.Mock<void, [unknown, string[]]>;
  resetSession: jest.Mock<void, []>;
  ensureReady: jest.Mock<Promise<void>, [{ force?: boolean }?]>;
};

type TestTab = {
  id: string;
  openSessionId: string | null;
  sessionFile: string | null;
  draftModel: string | null;
  service: TestService | null;
  serviceInitialized: boolean;
  state: {
    isStreaming: boolean;
    uiStore?: ChatUiStore;
    messages?: ChatMessage[];
    autoScrollEnabled?: boolean;
  };
  controllers: {
    inputController?: { cancelStreaming: jest.Mock<void, []> };
    openSessionController?: {
      createNew: jest.Mock<Promise<void>, [{ force: true }?]>;
    };
  };
  ui: {
    inlineContextManager?: {
      addSelectionFromEditor: jest.Mock<boolean, [Editor, MarkdownView]>;
    };
    externalContextSelector?: {
      getExternalContexts: jest.Mock<string[], []>;
    };
    composerActions?: Record<string, unknown> | null;
  };
  dom?: {
    welcomePortalEl: HTMLElement;
    queuePortalEl: HTMLElement;
    todoPortalEl: HTMLElement;
    navigationPortalEl: HTMLElement;
    messagesPortalEl: HTMLElement;
    composerPortalEl: HTMLElement;
    messagesBottomControlsEl: HTMLElement;
    messagesEl: HTMLElement;
  };
  renderer?: null;
};

type TestManager = {
  canCreateTab: jest.Mock<boolean, []>;
  createTab: jest.Mock<Promise<unknown>, []>;
  createNewSession: jest.Mock<Promise<void>, []>;
  closeTab: jest.Mock<Promise<boolean>, [string]>;
  getActiveTab: jest.Mock<TestTab | null, []>;
  getActiveTabId: jest.Mock<string | null, []>;
  getAllTabs: jest.Mock<TestTab[], []>;
  getTabBarItems: jest.Mock<ChatTabSnapshotItem[], []>;
  getPersistedState: jest.Mock<PersistedTabManagerState, []>;
  restoreState: jest.Mock<Promise<void>, [unknown]>;
  primeAgentRuntime: jest.Mock<void, []>;
  destroy: jest.Mock<Promise<void>, []>;
  switchToTab: jest.Mock<Promise<void>, [string]>;
  broadcastToAllTabs: jest.Mock<Promise<void>, [(service: TestService) => Promise<void>]>;
  invalidateSlashCommandCaches: jest.Mock<void, []>;
  prefetchSlashCommandCaches: jest.Mock<void, []>;
  syncPinnedExternalContextPaths: jest.Mock<void, [string[]]>;
};

function createService(overrides: Partial<TestService> = {}): TestService {
  return {
    reloadMcpServers: jest.fn(async () => undefined),
    syncSession: jest.fn(),
    resetSession: jest.fn(),
    ensureReady: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createTab(overrides: Partial<TestTab> = {}): TestTab {
  return {
    id: 'tab-1',
    openSessionId: 'session-1',
    sessionFile: '.pivi/sessions/one.jsonl',
    draftModel: 'draft-model',
    service: createService(),
    serviceInitialized: true,
    state: { isStreaming: false },
    controllers: {},
    ui: {},
    ...overrides,
  };
}

function createManager(): TestManager {
  return {
    canCreateTab: jest.fn(() => true),
    createTab: jest.fn(async () => ({ id: 'created' })),
    createNewSession: jest.fn(async () => undefined),
    closeTab: jest.fn(async (_tabId: string) => true),
    getActiveTab: jest.fn(() => null),
    getActiveTabId: jest.fn(() => null),
    getAllTabs: jest.fn(() => []),
    getTabBarItems: jest.fn(() => []),
    getPersistedState: jest.fn(() => ({ openTabs: [], activeTabId: null })),
    restoreState: jest.fn(async (_state: unknown) => undefined),
    primeAgentRuntime: jest.fn(),
    destroy: jest.fn(async () => undefined),
    switchToTab: jest.fn(async (_tabId: string) => undefined),
    broadcastToAllTabs: jest.fn(async (
      _visit: (service: TestService) => Promise<void>,
    ) => undefined),
    invalidateSlashCommandCaches: jest.fn(),
    prefetchSlashCommandCaches: jest.fn(),
    syncPinnedExternalContextPaths: jest.fn(),
  };
}

function createPortalElement(): HTMLElement {
  return {} as HTMLElement;
}

function createPresentationTab(uiStore: ChatUiStore): TestTab {
  return createTab({
    state: {
      isStreaming: false,
      messages: [],
      uiStore,
    },
    dom: {
      welcomePortalEl: createPortalElement(),
      queuePortalEl: createPortalElement(),
      todoPortalEl: createPortalElement(),
      navigationPortalEl: createPortalElement(),
      messagesPortalEl: createPortalElement(),
      composerPortalEl: createPortalElement(),
      messagesBottomControlsEl: createPortalElement(),
      messagesEl: createPortalElement(),
    },
    renderer: null,
  });
}

type HarnessOptions = {
  persistedState?: PersistedTabManagerState | null;
  ownerWindow?: Pick<Window, 'cancelAnimationFrame' | 'requestAnimationFrame'> | null;
};

function createHarness(options: HarnessOptions = {}) {
  const manager = createManager();
  jest.mocked(TabManager).mockImplementation(() => manager as unknown as TabManager);

  const persistTabStateImmediate = jest.fn(async () => undefined);
  const inputPortalContainer = {
    parentElement: null,
    remove: jest.fn(),
  } as unknown as HTMLElement;
  const ownerDocument = {
    createElement: jest.fn(() => inputPortalContainer),
    defaultView: options.ownerWindow ?? null,
  } as unknown as Document;
  const loadPersistedTabState = jest.fn(async () => options.persistedState ?? null);
  const plugin = {
    app: { workspace: {} },
    settings: { tabBarPosition: 'header' },
    getUiFacades: jest.fn(),
    getAllViews: jest.fn(),
    loadTabManagerState: jest.fn(),
    persistTabManagerState: jest.fn(),
  };
  const adapter = createImperativeChatAdapter({
    plugin: plugin as unknown as PiviChatCompositionHost,
    view: {} as never,
    getContainerEl: () => ({ ownerDocument }) as HTMLElement,
    chatIcon: null,
    persistTabState: jest.fn(),
    persistTabStateImmediate,
    loadPersistedTabState,
    activateOpenSessionElsewhere: jest.fn(async () => false),
  });

  const mount = async (): Promise<void> => {
    await adapter.mount(
      { empty: jest.fn() } as unknown as HTMLElement,
      {} as never,
      {} as ChatPorts,
    );
  };

  return {
    adapter,
    handle: adapter.getViewHandle(),
    inputPortalContainer,
    loadPersistedTabState,
    manager,
    mount,
    ownerDocument,
    persistTabStateImmediate,
    plugin,
  };
}

describe('imperative chat semantic view handle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs TabManager with an app-only runtime host', async () => {
    const { mount, plugin } = createHarness();

    await mount();

    expect(TabManager).toHaveBeenCalledTimes(1);
    const [runtimeHost] = jest.mocked(TabManager).mock.calls[0]!;
    expect(runtimeHost).toEqual({ app: plugin.app });
    expect(Object.keys(runtimeHost)).toEqual(['app']);
  });

  it('restores non-empty persisted bindings and creates a blank tab otherwise', async () => {
    const persistedState: PersistedTabManagerState = {
      openTabs: [{ tabId: 'restored-tab', sessionFile: '.pivi/sessions/restored.jsonl' }],
      activeTabId: 'restored-tab',
    };
    const restored = createHarness({ persistedState });

    await restored.mount();

    expect(restored.loadPersistedTabState).toHaveBeenCalledTimes(1);
    expect(restored.manager.restoreState).toHaveBeenCalledWith(persistedState);
    expect(restored.manager.createTab).not.toHaveBeenCalled();
    expect(restored.manager.primeAgentRuntime).toHaveBeenCalledTimes(1);

    const blank = createHarness({
      persistedState: { openTabs: [], activeTabId: null },
    });
    await blank.mount();

    expect(blank.manager.restoreState).not.toHaveBeenCalled();
    expect(blank.manager.createTab).toHaveBeenCalledTimes(1);
    expect(blank.manager.primeAgentRuntime).toHaveBeenCalledTimes(1);
  });

  it('activates the current tab snapshot, portal targets, and store relay', async () => {
    const { adapter, manager, mount, ownerDocument } = createHarness();
    const uiStore = new ChatUiStore(createInitialChatUiSnapshot());
    const activeTab = createPresentationTab(uiStore);
    const tabItem: ChatTabSnapshotItem = {
      id: activeTab.id,
      index: 1,
      title: 'Active tab',
      isActive: true,
      isStreaming: false,
      needsAttention: false,
      isArchived: false,
      canClose: true,
    };
    manager.getActiveTab.mockReturnValue(activeTab);
    manager.getTabBarItems.mockReturnValue([tabItem]);

    const shell = adapter.prepareShell(ownerDocument);
    const activeChanges = jest.fn();
    shell.activeChat.subscribe(activeChanges);

    await mount();

    expect(shell.store.getSnapshot().items).toEqual([tabItem]);
    expect(shell.activeChat.getSnapshot()).toBe(uiStore.getSnapshot());
    expect(shell.activeChat.getPortalTargets()).toEqual({
      welcome: activeTab.dom?.welcomePortalEl,
      queue: activeTab.dom?.queuePortalEl,
      todo: activeTab.dom?.todoPortalEl,
      navigation: activeTab.dom?.navigationPortalEl,
      messages: activeTab.dom?.messagesPortalEl,
      composer: activeTab.dom?.composerPortalEl,
    });

    activeChanges.mockClear();
    uiStore.update({ isStreaming: true });
    expect(shell.activeChat.getSnapshot().isStreaming).toBe(true);
    expect(activeChanges).toHaveBeenCalledWith(new Set(['isStreaming']));
  });

  it('destroys the manager and detaches bridge, store, portal, and pending RAF work', async () => {
    const requestAnimationFrame = jest.fn(() => 73);
    const cancelAnimationFrame = jest.fn();
    const harness = createHarness({
      ownerWindow: { requestAnimationFrame, cancelAnimationFrame },
    });
    const uiStore = new ChatUiStore(createInitialChatUiSnapshot());
    harness.manager.getActiveTab.mockReturnValue(createPresentationTab(uiStore));
    const shell = harness.adapter.prepareShell(harness.ownerDocument);
    const activeChanges = jest.fn();
    shell.activeChat.subscribe(activeChanges);
    await harness.mount();

    const callbacks = jest.mocked(TabManager).mock.calls[0]?.[3] as TabManagerCallbacks;
    callbacks.onTabTitleChanged?.('tab-1', 'Scheduled title');
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    harness.inputPortalContainer.remove = jest.fn();
    activeChanges.mockClear();
    const tabSnapshotBeforeDispose = shell.store.getSnapshot();
    await harness.adapter.dispose();

    expect(harness.manager.destroy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(73);
    expect(harness.inputPortalContainer.remove).toHaveBeenCalledTimes(1);
    expect(shell.activeChat.getPortalTargets()).toBeNull();
    expect(shell.activeChat.getComposerActions()).toBeNull();
    expect(shell.activeChat.getMessagePresentation()).toBeNull();

    uiStore.update({ isStreaming: true });
    expect(activeChanges).not.toHaveBeenCalled();

    harness.manager.getTabBarItems.mockReturnValue([{
      id: 'detached',
      index: 1,
      title: 'Must not publish',
      isActive: true,
      isStreaming: false,
      needsAttention: false,
      isArchived: false,
      canClose: true,
    }]);
    callbacks.onTabTitleChanged?.('detached', 'Must not publish');
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(shell.store.getSnapshot()).toBe(tabSnapshotBeforeDispose);

    await harness.adapter.dispose();
    expect(harness.manager.destroy).toHaveBeenCalledTimes(1);
  });

  it('releases presentation resources when manager destruction fails', async () => {
    const harness = createHarness();
    const uiStore = new ChatUiStore(createInitialChatUiSnapshot());
    harness.manager.getActiveTab.mockReturnValue(createPresentationTab(uiStore));
    const shell = harness.adapter.prepareShell(harness.ownerDocument);
    const activeChanges = jest.fn();
    shell.activeChat.subscribe(activeChanges);
    await harness.mount();

    const destroyError = new Error('manager destroy failed');
    harness.manager.destroy.mockRejectedValue(destroyError);
    harness.inputPortalContainer.remove = jest.fn();
    activeChanges.mockClear();

    await expect(harness.adapter.dispose()).rejects.toBe(destroyError);

    expect(harness.inputPortalContainer.remove).toHaveBeenCalledTimes(1);
    expect(shell.activeChat.getPortalTargets()).toBeNull();
    expect(shell.activeChat.getComposerActions()).toBeNull();
    expect(shell.activeChat.getMessagePresentation()).toBeNull();
    expect(harness.handle.commands.getState().mounted).toBe(false);

    uiStore.update({ isStreaming: true });
    expect(activeChanges).not.toHaveBeenCalled();

    await expect(harness.adapter.dispose()).resolves.toBeUndefined();
    expect(harness.manager.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports safe command state before mount and mounted capabilities afterward', async () => {
    const { handle, manager, mount } = createHarness();

    expect(handle.commands.getState()).toEqual({
      mounted: false,
      canCreateTab: false,
      canStartNewSession: false,
      canCloseActiveTab: false,
    });

    await mount();
    const activeTab = createTab();
    manager.getActiveTab.mockReturnValue(activeTab);
    manager.getActiveTabId.mockReturnValue(activeTab.id);

    expect(handle.commands.getState()).toEqual({
      mounted: true,
      canCreateTab: true,
      canStartNewSession: true,
      canCloseActiveTab: true,
    });

    activeTab.state.isStreaming = true;
    manager.canCreateTab.mockReturnValue(false);
    expect(handle.commands.getState()).toEqual({
      mounted: true,
      canCreateTab: false,
      canStartNewSession: false,
      canCloseActiveTab: true,
    });
  });

  it('guards start, close, and cancel commands by active-tab state', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    expect(await handle.commands.startNewSession()).toBe(false);
    expect(await handle.commands.closeActiveTab()).toBe(false);
    expect(handle.commands.cancelActiveTurn()).toBe(false);

    const cancelStreaming = jest.fn();
    const activeTab = createTab({
      controllers: { inputController: { cancelStreaming } },
    });
    manager.getActiveTab.mockReturnValue(activeTab);
    manager.getActiveTabId.mockReturnValue(activeTab.id);

    expect(await handle.commands.startNewSession()).toBe(true);
    expect(manager.createNewSession).toHaveBeenCalledTimes(1);
    expect(await handle.commands.closeActiveTab()).toBe(true);
    expect(manager.closeTab).toHaveBeenCalledWith(activeTab.id);
    expect(handle.commands.cancelActiveTurn()).toBe(false);

    activeTab.state.isStreaming = true;
    expect(await handle.commands.startNewSession()).toBe(false);
    expect(handle.commands.cancelActiveTurn()).toBe(true);
    expect(cancelStreaming).toHaveBeenCalledTimes(1);
  });

  it('projects editor selection, inline model precedence, and copied external contexts', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    const addSelectionFromEditor = jest.fn(
      (_editor: Editor, _markdownView: MarkdownView) => true,
    );
    const externalContexts = ['/outside/one', '/outside/two'];
    const getExternalContexts = jest.fn(() => externalContexts);
    const getAuxiliaryModel = jest.fn<string | null, []>(() => 'runtime-model');
    const activeTab = createTab({
      service: createService({ getAuxiliaryModel }),
      ui: {
        inlineContextManager: { addSelectionFromEditor },
        externalContextSelector: { getExternalContexts },
      },
    });
    manager.getActiveTab.mockReturnValue(activeTab);

    const editor = {} as Editor;
    const markdownView = {} as MarkdownView;
    expect(handle.commands.addEditorSelection(editor, markdownView)).toBe(true);
    expect(addSelectionFromEditor).toHaveBeenCalledWith(editor, markdownView);
    expect(handle.commands.getInlineEditModel()).toBe('runtime-model');

    getAuxiliaryModel.mockReturnValue(null);
    expect(handle.commands.getInlineEditModel()).toBe('draft-model');

    const projectedContexts = handle.commands.getActiveExternalContexts();
    expect(projectedContexts).toEqual(externalContexts);
    expect(projectedContexts).not.toBe(externalContexts);
    projectedContexts.push('/mutated-copy');
    expect(externalContexts).toEqual(['/outside/one', '/outside/two']);
  });

  it('force-resets every matching session tab and cancels matching streams first', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    const streamingCancel = jest.fn();
    const streamingCreateNew = jest.fn(async () => undefined);
    const idleCreateNew = jest.fn(async () => undefined);
    const unrelatedCreateNew = jest.fn(async () => undefined);
    manager.getAllTabs.mockReturnValue([
      createTab({
        id: 'streaming',
        state: { isStreaming: true },
        controllers: {
          inputController: { cancelStreaming: streamingCancel },
          openSessionController: { createNew: streamingCreateNew },
        },
      }),
      createTab({
        id: 'idle',
        controllers: { openSessionController: { createNew: idleCreateNew } },
      }),
      createTab({
        id: 'other',
        openSessionId: 'session-2',
        controllers: { openSessionController: { createNew: unrelatedCreateNew } },
      }),
    ]);

    await handle.maintenance.resetSession('session-1');

    expect(streamingCancel).toHaveBeenCalledTimes(1);
    expect(streamingCreateNew).toHaveBeenCalledWith({ force: true });
    expect(idleCreateNew).toHaveBeenCalledWith({ force: true });
    expect(unrelatedCreateNew).not.toHaveBeenCalled();
  });

  it('returns unique bound session files and activates sessions without exposing tabs', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    manager.getAllTabs.mockReturnValue([
      createTab({ id: 'one', openSessionId: 'session-1' }),
      createTab({
        id: 'duplicate',
        openSessionId: 'session-2',
        sessionFile: '.pivi/sessions/one.jsonl',
      }),
      createTab({ id: 'unbound', openSessionId: null, sessionFile: null }),
    ]);

    expect(handle.maintenance.getBoundSessionFiles()).toEqual([
      '.pivi/sessions/one.jsonl',
    ]);
    expect(handle.maintenance.hasSession('session-2')).toBe(true);
    expect(handle.maintenance.hasSession('missing')).toBe(false);
    await expect(handle.maintenance.activateSession('session-2')).resolves.toBe(true);
    expect(manager.switchToTab).toHaveBeenCalledWith('duplicate');
    await expect(handle.maintenance.activateSession('missing')).resolves.toBe(false);
  });

  it('refreshes prompt, MCP servers, and skills through initialized runtime broadcasts', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    const first = createService({
      syncSystemPrompt: jest.fn(async () => undefined),
    });
    const second = createService();
    const services = [first, second];
    manager.broadcastToAllTabs.mockImplementation(async (visit) => {
      for (const service of services) await visit(service);
    });

    await handle.maintenance.refreshRuntimePrompt();
    expect(first.syncSystemPrompt).toHaveBeenCalledTimes(1);
    expect(first.ensureReady).not.toHaveBeenCalled();
    expect(second.ensureReady).toHaveBeenCalledWith({ force: true });

    await handle.maintenance.reloadMcpServers();
    expect(first.reloadMcpServers).toHaveBeenCalledTimes(1);
    expect(second.reloadMcpServers).toHaveBeenCalledTimes(1);

    await handle.maintenance.refreshVaultSkills();
    expect(manager.invalidateSlashCommandCaches).toHaveBeenCalledTimes(1);
    expect(first.syncSystemPrompt).toHaveBeenCalledTimes(2);
    expect(second.syncSystemPrompt).toBeUndefined();
  });

  it('resets model-changed runtimes and force-readies other environment changes', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    const cancelStreaming = jest.fn();
    const modelService = createService();
    const externalContexts = ['/external'];
    const tab = createTab({
      state: { isStreaming: true },
      controllers: { inputController: { cancelStreaming } },
      service: modelService,
      ui: {
        externalContextSelector: {
          getExternalContexts: jest.fn(() => externalContexts),
        },
      },
    });
    manager.getAllTabs.mockReturnValue([tab]);

    await expect(handle.maintenance.applyEnvironmentRuntimeChange(true)).resolves.toEqual({
      failedTabs: 0,
    });
    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(modelService.syncSession).toHaveBeenCalledWith(
      { sessionFile: '.pivi/sessions/one.jsonl' },
      externalContexts,
    );
    expect(modelService.resetSession).toHaveBeenCalledTimes(1);
    expect(modelService.ensureReady).toHaveBeenCalledWith();

    modelService.resetSession.mockClear();
    modelService.ensureReady.mockClear();
    await handle.maintenance.applyEnvironmentRuntimeChange(false);
    expect(modelService.resetSession).not.toHaveBeenCalled();
    expect(modelService.ensureReady).toHaveBeenCalledWith({ force: true });
  });

  it('counts failed environment restarts and skips uninitialized services', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();

    const failed = createService({
      ensureReady: jest.fn(async () => {
        throw new Error('restart failed');
      }),
    });
    const skipped = createService();
    manager.getAllTabs.mockReturnValue([
      createTab({ id: 'failed', service: failed }),
      createTab({ id: 'skipped', service: skipped, serviceInitialized: false }),
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(handle.maintenance.applyEnvironmentRuntimeChange(false)).resolves.toEqual({
      failedTabs: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      'Pivi: tab failed to restart after environment change',
      expect.any(Error),
    );
    expect(skipped.syncSession).not.toHaveBeenCalled();
    expect(skipped.ensureReady).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('persists the current manager state immediately', async () => {
    const { handle, manager, mount, persistTabStateImmediate } = createHarness();

    await expect(handle.maintenance.persistState()).resolves.toBeUndefined();
    expect(persistTabStateImmediate).not.toHaveBeenCalled();

    await mount();
    await handle.maintenance.persistState();
    expect(persistTabStateImmediate).toHaveBeenCalledWith({
      openTabs: [],
      activeTabId: null,
    });
  });
});
