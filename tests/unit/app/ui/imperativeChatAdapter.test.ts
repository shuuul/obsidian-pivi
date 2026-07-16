import {
  ChatUiStore,
  ChatProjectionStore,
  createInitialChatUiSnapshot,
  NOOP_CHAT_PERF_RECORDER,
  type ChatPerfRecorder,
  type ChatTabSnapshotItem,
} from '@pivi/pivi-react/store';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Component, type Editor, type MarkdownView } from 'obsidian';

import type { PiviChatCompositionHost } from '@/app/hostContracts';
import { createImperativeChatAdapter } from '@/app/ui/imperativeChatAdapter';
import {
  runDevelopmentMarkdownStream,
  runDevelopmentMarkdownStreamInIsolatedTab,
  runDevelopmentTabSwitching,
} from '@/app/ui/imperativeChatViewHandle';
import { ChatState } from '@/ui/chat/state/ChatState';
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
    projectionStore?: ChatProjectionStore;
    messages?: ChatMessage[];
    autoScrollEnabled?: boolean;
  };
  controllers: {
    inputController?: {
      cancelStreaming?: jest.Mock<void, []>;
      sendMessage?: jest.Mock<Promise<void>, [{ content: string }]>;
    };
    openSessionController?: {
      createNew: jest.Mock<Promise<void>, [{ force: true }?]>;
      loadOlderMessages?: jest.Mock<Promise<boolean>, []>;
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
  renderer?: {
    component: Component;
    renderContent: jest.Mock<Promise<void>, [HTMLElement, string, unknown?]>;
    forkCallback?: jest.Mock<Promise<void>, [string]>;
    redoCallback?: jest.Mock<Promise<void>, [string]>;
  } | null;
};

type TestManager = {
  canCreateTab: jest.Mock<boolean, []>;
  createTab: jest.Mock<Promise<TestTab | null>, [string?, string?, Record<string, unknown>?]>;
  createNewSession: jest.Mock<Promise<void>, []>;
  closeTab: jest.Mock<Promise<boolean>, [string, boolean?]>;
  getActiveTab: jest.Mock<TestTab | null, []>;
  getActiveTabId: jest.Mock<string | null, []>;
  getAllTabs: jest.Mock<TestTab[], []>;
  getTab: jest.Mock<TestTab | null, [string]>;
  getTabBarItems: jest.Mock<ChatTabSnapshotItem[], []>;
  getPersistedState: jest.Mock<PersistedTabManagerState, []>;
  restoreState: jest.Mock<Promise<void>, [unknown]>;
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
    createTab: jest.fn(async () => createTab({ id: 'created' })),
    createNewSession: jest.fn(async () => undefined),
    closeTab: jest.fn(async (_tabId: string) => true),
    getActiveTab: jest.fn(() => null),
    getActiveTabId: jest.fn(() => null),
    getAllTabs: jest.fn(() => []),
    getTab: jest.fn((_tabId: string) => null),
    getTabBarItems: jest.fn(() => []),
    getPersistedState: jest.fn(() => ({ openTabs: [], activeTabId: null })),
    restoreState: jest.fn(async (_state: unknown) => undefined),
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
  return { appendChild: jest.fn() } as unknown as HTMLElement;
}

function createPresentationTab(uiStore: ChatUiStore): TestTab {
  return createTab({
    state: {
      isStreaming: false,
      messages: [],
      projectionStore: new ChatProjectionStore(),
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
    renderer: {
      component: new Component(),
      renderContent: jest.fn(async (_target: HTMLElement, _markdown: string) => undefined),
    },
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
  const persistTabState = jest.fn();
  const plugin = {
    app: {
      vault: {
        adapter: {
          exists: jest.fn(async (path: string) => path.endsWith('.jsonl')),
          read: jest.fn(async () => '{"type":"session","id":"fixture"}\n'),
          remove: jest.fn(async () => undefined),
          write: jest.fn(async () => undefined),
        },
      },
      workspace: {},
    },
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
    persistTabState,
    persistTabStateImmediate,
    loadPersistedTabState,
    activateOpenSessionElsewhere: jest.fn(async () => false),
    perfRecorder: NOOP_CHAT_PERF_RECORDER,
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
    persistTabState,
    persistTabStateImmediate,
    plugin,
  };
}

describe('imperative chat semantic view handle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('drives an exact 100 KB Markdown stream and restores the active state', async () => {
    let now = 0;
    const ownerWindow = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
      setTimeout: (callback: TimerHandler, delay?: number) => {
        now += delay ?? 0;
        if (typeof callback === 'function') callback();
        return now;
      },
    } as unknown as Window;
    const originalMessages: ChatMessage[] = [{
      id: 'existing',
      role: 'user',
      content: 'keep me',
      timestamp: 1,
    }];
    const publishedLengths: number[] = [];
    const state = {
      messages: originalMessages,
      isStreaming: false,
      addMessage(message: ChatMessage) {
        this.messages = [...this.messages, message];
      },
      notifyMessageChanged(message: ChatMessage) {
        publishedLengths.push(message.content.length);
      },
      flushProjection: jest.fn(),
    };

    const result = await runDevelopmentMarkdownStream(state, ownerWindow);

    expect(result).toMatchObject({ bytes: 100 * 1024, chunks: 64 });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(publishedLengths).toHaveLength(64);
    expect(publishedLengths.at(-1)).toBe(100 * 1024);
    expect(state.flushProjection).toHaveBeenCalledTimes(1);
    expect(state.messages).toBe(originalMessages);
    expect(state.isStreaming).toBe(false);
  });

  it('keeps the 100 KB stream within the 67-commit projection budget', async () => {
    let now = 0;
    let frameId = 0;
    const ownerWindow = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++frameId;
        queueMicrotask(() => {
          now += 16;
          callback(now);
        });
        return id;
      },
      cancelAnimationFrame: jest.fn(),
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === 'function') queueMicrotask(() => callback());
        return ++frameId;
      },
    } as unknown as Window;
    const recorder: ChatPerfRecorder = {
      enabled: true,
      now: () => now,
      onMarkdownRender: jest.fn(),
      onProjectionCommit: jest.fn(),
      onProjectionEvent: jest.fn(),
      onProjectionPaint: jest.fn(),
      onScrollAnchor: jest.fn(),
      onVirtualRows: jest.fn(),
    };
    const state = new ChatState({}, recorder);
    state.projectionStore.setOwnerWindow(ownerWindow);

    await expect(runDevelopmentMarkdownStream(state, ownerWindow))
      .resolves.toMatchObject({ bytes: 100 * 1024, chunks: 64 });

    expect(recorder.onProjectionCommit).toHaveBeenCalledTimes(67);
    state.projectionStore.dispose();
  });

  it('runs the Markdown stream in a disposable tab and restores the original tab', async () => {
    let now = 0;
    const ownerWindow = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
      setTimeout: (callback: TimerHandler, delay?: number) => {
        now += delay ?? 0;
        if (typeof callback === 'function') callback();
        return now;
      },
    } as unknown as Window;
    const original = createTab({ id: 'original' });
    const syntheticState = {
      messages: [] as ChatMessage[],
      isStreaming: false,
      addMessage(message: ChatMessage) {
        this.messages = [...this.messages, message];
      },
      notifyMessageChanged: jest.fn(),
      flushProjection: jest.fn(),
    };
    const synthetic = createTab({
      id: 'synthetic',
      openSessionId: null,
      sessionFile: null,
      state: syntheticState,
      dom: {
        welcomePortalEl: createPortalElement(),
        queuePortalEl: createPortalElement(),
        todoPortalEl: createPortalElement(),
        navigationPortalEl: createPortalElement(),
        messagesPortalEl: createPortalElement(),
        composerPortalEl: createPortalElement(),
        messagesBottomControlsEl: createPortalElement(),
        messagesEl: { ownerDocument: { defaultView: ownerWindow } } as unknown as HTMLElement,
      },
    });
    const tabs = new Map<string, TestTab>([[original.id, original]]);
    const manager = createManager();
    let activeTabId = original.id;
    manager.getActiveTabId.mockImplementation(() => activeTabId);
    manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    manager.createTab.mockImplementation(async (_openSessionId, tabId) => {
      synthetic.id = tabId!;
      tabs.set(synthetic.id, synthetic);
      activeTabId = synthetic.id;
      return synthetic;
    });
    manager.switchToTab.mockImplementation(async (tabId: string) => {
      activeTabId = tabId;
    });
    manager.closeTab.mockImplementation(async (tabId: string) => tabs.delete(tabId));

    await expect(runDevelopmentMarkdownStreamInIsolatedTab(manager as unknown as TabManager))
      .resolves.toMatchObject({ bytes: 100 * 1024, chunks: 64 });

    expect(manager.createTab).toHaveBeenCalledTimes(1);
    expect(synthetic.id).toMatch(/^pivi-development-markdown-stream-/);
    expect(synthetic.sessionFile).toBeNull();
    expect(syntheticState.messages).toEqual([]);
    expect(manager.switchToTab).toHaveBeenLastCalledWith('original');
    expect(manager.closeTab).toHaveBeenCalledWith(synthetic.id, true);
    expect([...tabs.keys()]).toEqual(['original']);
  });

  it('creates and removes a deterministic ten-tab switching workload', async () => {
    let now = 0;
    const ownerWindow = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
    } as unknown as Window;
    const manager = createManager();
    const original = createTab({ id: 'original' });
    const tabs = new Map<string, TestTab>([[original.id, original]]);
    let activeTabId = original.id;
    manager.getActiveTabId.mockImplementation(() => activeTabId);
    manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    manager.createTab.mockImplementation(async (_openSessionId, tabId) => {
      const tab = createTab({
        id: tabId!,
        openSessionId: null,
        sessionFile: null,
        state: { isStreaming: false, messages: [] },
      });
      tabs.set(tab.id, tab);
      return tab;
    });
    manager.switchToTab.mockImplementation(async (tabId: string) => {
      activeTabId = tabId;
    });
    manager.closeTab.mockImplementation(async (tabId: string) => tabs.delete(tabId));

    await expect(
      runDevelopmentTabSwitching(manager as unknown as TabManager, ownerWindow),
    ).resolves.toEqual({ tabs: 10, switches: 20, durationMs: 640 });

    expect(manager.createTab).toHaveBeenCalledTimes(10);
    expect([...tabs.keys()]).toEqual(['original']);
    expect(manager.switchToTab).toHaveBeenLastCalledWith('original');
    expect(manager.closeTab).toHaveBeenCalledTimes(10);
    for (const call of manager.createTab.mock.results) {
      const tab = await call.value;
      expect(tab?.state.messages).toHaveLength(100);
      expect(tab?.sessionFile).toBeNull();
    }
  });

  it('suspends debounced and immediate persistence during the tab workload', async () => {
    let now = 0;
    const ownerWindow = {
      cancelAnimationFrame: jest.fn(),
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
    } as unknown as Window;
    const harness = createHarness({ ownerWindow });
    const activeTab = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    activeTab.id = 'original';
    activeTab.dom!.messagesEl = {
      ownerDocument: { defaultView: ownerWindow },
    } as unknown as HTMLElement;
    const tabs = new Map<string, TestTab>([[activeTab.id, activeTab]]);
    let activeTabId = activeTab.id;

    await harness.mount();
    const callbacks = jest.mocked(TabManager).mock.calls[0]![3] as TabManagerCallbacks;
    harness.manager.getActiveTab.mockImplementation(() => tabs.get(activeTabId) ?? null);
    harness.manager.getActiveTabId.mockImplementation(() => activeTabId);
    harness.manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    harness.manager.createTab.mockImplementation(async (_openSessionId, tabId) => {
      await harness.handle.maintenance.persistState();
      const tab = createTab({
        id: tabId!,
        openSessionId: null,
        sessionFile: null,
        state: { isStreaming: false, messages: [] },
      });
      tabs.set(tab.id, tab);
      callbacks.onTabCreated?.(tab as never);
      return tab;
    });
    harness.manager.switchToTab.mockImplementation(async (tabId: string) => {
      const previous = activeTabId;
      activeTabId = tabId;
      callbacks.onTabSwitched?.(previous, tabId);
    });
    harness.manager.closeTab.mockImplementation(async (tabId: string) => {
      const removed = tabs.delete(tabId);
      if (removed) callbacks.onTabClosed?.(tabId);
      return removed;
    });

    await expect(harness.handle.development?.runTabSwitchingWorkload())
      .resolves.toMatchObject({ tabs: 10, switches: 20 });

    expect(harness.persistTabState).not.toHaveBeenCalled();
    expect(harness.persistTabStateImmediate).not.toHaveBeenCalled();
    await harness.handle.maintenance.persistState();
    expect(harness.persistTabStateImmediate).toHaveBeenCalledTimes(1);
    expect([...tabs.keys()]).toEqual(['original']);
  });

  it('isolates the Markdown stream from user tabs and tab persistence', async () => {
    let now = 0;
    const ownerWindow = {
      cancelAnimationFrame: jest.fn(),
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
      setTimeout: (callback: TimerHandler, delay?: number) => {
        now += delay ?? 0;
        if (typeof callback === 'function') callback();
        return now;
      },
    } as unknown as Window;
    const harness = createHarness({ ownerWindow });
    const original = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    original.id = 'original';
    const tabs = new Map<string, TestTab>([[original.id, original]]);
    let activeTabId = original.id;

    await harness.mount();
    const callbacks = jest.mocked(TabManager).mock.calls[0]![3] as TabManagerCallbacks;
    harness.manager.getActiveTab.mockImplementation(() => tabs.get(activeTabId) ?? null);
    harness.manager.getActiveTabId.mockImplementation(() => activeTabId);
    harness.manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    harness.manager.createTab.mockImplementation(async (_openSessionId, tabId) => {
      await harness.handle.maintenance.persistState();
      const state = new ChatState({}, NOOP_CHAT_PERF_RECORDER);
      const tab = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
      tab.id = tabId!;
      tab.openSessionId = null;
      tab.sessionFile = null;
      tab.state = state as unknown as TestTab['state'];
      tab.dom!.messagesEl = {
        ownerDocument: { defaultView: ownerWindow },
      } as unknown as HTMLElement;
      tabs.set(tab.id, tab);
      activeTabId = tab.id;
      callbacks.onTabCreated?.(tab as never);
      return tab;
    });
    harness.manager.switchToTab.mockImplementation(async (tabId: string) => {
      const previous = activeTabId;
      activeTabId = tabId;
      callbacks.onTabSwitched?.(previous, tabId);
    });
    harness.manager.closeTab.mockImplementation(async (tabId: string) => {
      const removed = tabs.delete(tabId);
      if (removed) callbacks.onTabClosed?.(tabId);
      return removed;
    });

    await expect(harness.handle.development?.run100KbMarkdownStream())
      .resolves.toMatchObject({ bytes: 100 * 1024, chunks: 64 });

    expect(harness.persistTabState).not.toHaveBeenCalled();
    expect(harness.persistTabStateImmediate).not.toHaveBeenCalled();
    expect([...tabs.keys()]).toEqual(['original']);
    expect(activeTabId).toBe('original');
  });

  it('isolates indexed cold-open and paging from tab persistence', async () => {
    let now = 0;
    const ownerWindow = {
      cancelAnimationFrame: jest.fn(),
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === 'function') callback();
        return 1;
      },
    } as unknown as Window;
    const harness = createHarness({ ownerWindow });
    const original = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    original.id = 'original';
    original.dom!.messagesEl = {
      ownerDocument: { defaultView: ownerWindow },
    } as unknown as HTMLElement;
    const tabs = new Map<string, TestTab>([[original.id, original]]);
    let activeTabId = original.id;
    const afterColdOpen = jest.fn(async () => undefined);
    const afterOlderPage = jest.fn(async () => undefined);

    await harness.mount();
    harness.manager.getActiveTab.mockImplementation(() => tabs.get(activeTabId) ?? null);
    harness.manager.getActiveTabId.mockImplementation(() => activeTabId);
    harness.manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    harness.manager.createTab.mockImplementation(async (_openSessionId, tabId, options) => {
      expect(options).toMatchObject({
        sessionFile: expect.stringMatching(
          /^\.pivi\/sessions\/perf-isolated-indexed-paging-\d+\.jsonl$/,
        ),
      });
      const messages = Array.from({ length: 100 }, (_, index) => ({
        id: `recent-${index}`,
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Recent ${index}`,
        timestamp: index,
      }));
      const loadOlderMessages = jest.fn(async () => {
        messages.unshift(...Array.from({ length: 100 }, (_, index) => ({
          id: `older-${index}`,
          role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: `Older ${index}`,
          timestamp: index,
        })));
        return true;
      });
      const messagesEl = {
        clientHeight: 600,
        dispatchEvent: jest.fn(() => {
          void loadOlderMessages();
          return true;
        }),
        ownerDocument: { defaultView: ownerWindow },
        scrollHeight: 10_000,
        scrollTop: 9_400,
      } as unknown as HTMLElement;
      const tab = createTab({
        id: tabId!,
        openSessionId: 'perf-session',
        sessionFile: options?.sessionFile as string,
        state: { isStreaming: false, messages },
        controllers: {
          openSessionController: {
            createNew: jest.fn(async () => undefined),
            loadOlderMessages,
          },
        },
        dom: {
          welcomePortalEl: createPortalElement(),
          queuePortalEl: createPortalElement(),
          todoPortalEl: createPortalElement(),
          navigationPortalEl: createPortalElement(),
          messagesPortalEl: createPortalElement(),
          composerPortalEl: createPortalElement(),
          messagesBottomControlsEl: createPortalElement(),
          messagesEl,
        },
      });
      tabs.set(tab.id, tab);
      activeTabId = tab.id;
      return tab;
    });
    harness.manager.switchToTab.mockImplementation(async (tabId: string) => {
      activeTabId = tabId;
    });
    harness.manager.closeTab.mockImplementation(async (tabId: string) => tabs.delete(tabId));

    await expect(harness.handle.development?.runIndexedSessionPagingWorkload({
      afterColdOpen,
      afterOlderPage,
    })).resolves.toEqual({ initialMessages: 100, messagesAfterPrepend: 200 });

    expect(afterColdOpen).toHaveBeenCalledTimes(1);
    expect(afterOlderPage).toHaveBeenCalledTimes(1);
    expect(activeTabId).toBe('original');
    expect([...tabs.keys()]).toEqual(['original']);
    expect(harness.persistTabState).not.toHaveBeenCalled();
    expect(harness.persistTabStateImmediate).not.toHaveBeenCalled();
    expect(harness.plugin.app.vault.adapter.write).toHaveBeenCalledTimes(1);
    expect(harness.plugin.app.vault.adapter.remove).toHaveBeenCalledTimes(1);
  });

  it('isolates the 20 Agent-run trace from user tabs and persistence', async () => {
    let now = 0;
    const ownerWindow = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        now += 16;
        callback(now);
        return now;
      },
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === 'function') callback();
        return 1;
      },
    } as unknown as Window;
    const harness = createHarness({ ownerWindow });
    const original = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    original.id = 'original';
    original.dom!.messagesEl = {
      ownerDocument: { defaultView: ownerWindow },
    } as unknown as HTMLElement;
    const tabs = new Map<string, TestTab>([[original.id, original]]);
    let activeTabId = original.id;

    await harness.mount();
    harness.manager.getActiveTab.mockImplementation(() => tabs.get(activeTabId) ?? null);
    harness.manager.getActiveTabId.mockImplementation(() => activeTabId);
    harness.manager.getTab = jest.fn((tabId: string) => tabs.get(tabId) ?? null) as never;
    harness.manager.createTab.mockImplementation(async (_openSessionId, tabId, options) => {
      expect(options).toMatchObject({
        sessionFile: expect.stringMatching(
          /^\.pivi\/sessions\/perf-isolated-agent-runs-\d+\.jsonl$/,
        ),
      });
      const toolCalls = Array.from({ length: 20 }, (_, index) => ({
        id: `spawn-${index}`,
        name: 'spawn_agent',
        input: {},
        status: 'completed' as const,
        isExpanded: false,
        subagent: {
          id: `spawn-${index}`,
          description: `Agent ${index}`,
          mode: 'async' as const,
          status: 'completed' as const,
          asyncStatus: 'completed' as const,
          toolCalls: [],
          isExpanded: false,
        },
      }));
      const tab = createTab({
        id: tabId!,
        state: {
          isStreaming: false,
          messages: [{
            id: 'assistant-owner',
            role: 'assistant',
            content: '',
            timestamp: 1,
            toolCalls,
          }],
        },
      });
      tabs.set(tab.id, tab);
      activeTabId = tab.id;
      return tab;
    });
    harness.manager.switchToTab.mockImplementation(async (tabId: string) => {
      activeTabId = tabId;
    });
    harness.manager.closeTab.mockImplementation(async (tabId: string) => tabs.delete(tabId));

    const afterRender = jest.fn(async () => {
      expect(activeTabId).toMatch(/^pivi-development-agent-runs-/);
      expect(tabs.size).toBe(2);
    });
    await expect(harness.handle.development?.run20AgentRunsWorkload({ afterRender }))
      .resolves.toEqual({ agentRuns: 20, messages: 1 });

    expect(afterRender).toHaveBeenCalledWith({ agentRuns: 20, messages: 1 });
    expect(activeTabId).toBe('original');
    expect([...tabs.keys()]).toEqual(['original']);
    expect(harness.persistTabState).not.toHaveBeenCalled();
    expect(harness.persistTabStateImmediate).not.toHaveBeenCalled();
    expect(harness.plugin.app.vault.adapter.write).toHaveBeenCalledTimes(1);
    expect(harness.plugin.app.vault.adapter.remove).toHaveBeenCalledTimes(1);
  });

  it('constructs TabManager with an app-only runtime host', async () => {
    const { mount, plugin } = createHarness();

    await mount();

    expect(TabManager).toHaveBeenCalledTimes(1);
    const [runtimeHost, , , , , , perfRecorder] = jest.mocked(TabManager).mock.calls[0]!;
    expect(runtimeHost).toEqual({ app: plugin.app });
    expect(Object.keys(runtimeHost)).toEqual(['app']);
    expect(perfRecorder).toBe(NOOP_CHAT_PERF_RECORDER);
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
    expect(restored.manager.prefetchSlashCommandCaches).toHaveBeenCalledTimes(1);

    const blank = createHarness({
      persistedState: { openTabs: [], activeTabId: null },
    });
    await blank.mount();

    expect(blank.manager.restoreState).not.toHaveBeenCalled();
    expect(blank.manager.createTab).toHaveBeenCalledTimes(1);
    expect(blank.manager.prefetchSlashCommandCaches).toHaveBeenCalledTimes(1);
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
      messagesViewport: activeTab.dom?.messagesEl,
      composer: activeTab.dom?.composerPortalEl,
    });

    activeChanges.mockClear();
    uiStore.update({ isStreaming: true });
    expect(shell.activeChat.getSnapshot().isStreaming).toBe(true);
    expect(activeChanges).toHaveBeenCalledWith(new Set(['isStreaming']));
  });

  it('aggregates background work across tabs and navigates through the owner viewport', async () => {
    const { adapter, manager, mount, ownerDocument } = createHarness();
    const activeTab = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    const backgroundTab = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    backgroundTab.id = 'tab-background';
    backgroundTab.state.projectionStore?.replaceAll([{
      id: 'assistant-owner',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'spawn-1', name: 'spawn_agent', input: {}, status: 'running',
        subagent: {
          id: 'run-1', description: 'Background audit', isExpanded: false,
          mode: 'async', status: 'running', asyncStatus: 'running', toolCalls: [],
        },
      }],
    }]);
    manager.getActiveTab.mockReturnValue(activeTab);
    manager.getAllTabs.mockReturnValue([activeTab, backgroundTab]);
    manager.getTab.mockImplementation(tabId => (
      tabId === activeTab.id ? activeTab : tabId === backgroundTab.id ? backgroundTab : null
    ));
    const shell = adapter.prepareShell(ownerDocument);
    await mount();

    expect(shell.activeChat.getActiveWorkShelfSnapshot().map(item => [item.tabId, item.run.runId]))
      .toEqual([['tab-background', 'run-1']]);
    const navigate = shell.activeChat.getActiveWorkShelfNavigate();
    await navigate?.('tab-background', 'assistant-owner');
    expect(manager.switchToTab).toHaveBeenCalledWith('tab-background');

    const callbacks = jest.mocked(TabManager).mock.calls[0]?.[3] as TabManagerCallbacks;
    callbacks.onTabWillSwitch?.(activeTab.id, backgroundTab.id);
    const scrollToMessage = jest.fn();
    shell.activeChat.getMessagePresentation()?.setViewportHandle?.({
      isAtEnd: () => false,
      scrollToEnd: () => undefined,
      scrollToMessage,
      scrollToRecentUser: () => undefined,
      scrollToStart: () => undefined,
      scrollToUser: () => undefined,
    });
    expect(scrollToMessage).toHaveBeenCalledWith('assistant-owner', 'center', 'smooth');
  });

  it('moves and republishes the tab bar when its setting changes', async () => {
    const harness = createHarness();
    const activeTab = createPresentationTab(new ChatUiStore(createInitialChatUiSnapshot()));
    harness.manager.getActiveTab.mockReturnValue(activeTab);
    const shell = harness.adapter.prepareShell(harness.ownerDocument);
    await harness.mount();

    expect(shell.store.getSnapshot().position).toBe('header');
    harness.plugin.settings.tabBarPosition = 'input';
    harness.handle.maintenance.refreshTabBarPosition();

    expect(shell.store.getSnapshot().position).toBe('input');
    expect(activeTab.dom?.messagesBottomControlsEl.appendChild)
      .toHaveBeenCalledWith(harness.inputPortalContainer);

    harness.inputPortalContainer.remove = jest.fn();
    harness.plugin.settings.tabBarPosition = 'header';
    harness.handle.maintenance.refreshTabBarPosition();

    expect(shell.store.getSnapshot().position).toBe('header');
    expect(harness.inputPortalContainer.remove).toHaveBeenCalledTimes(1);
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

  it('sends workspace command content through a newly created tab', async () => {
    const { handle, manager, mount } = createHarness();
    await mount();
    const sendMessage = jest.fn(async (_options: { content: string }) => undefined);
    const createdTab = createTab({ controllers: { inputController: { sendMessage } } });
    manager.createTab.mockResolvedValue(createdTab);
    manager.createTab.mockClear();

    await expect(handle.commands.sendWorkspaceCommandInNewSession('Resolved prompt'))
      .resolves.toBe(true);
    expect(manager.createTab).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ content: 'Resolved prompt' });
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
      '[Pivi:ImperativeChatAdapter] tab failed to restart after environment change',
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
