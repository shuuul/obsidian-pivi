import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { MessageViewportHandle } from '@pivi/pivi-react';
import {
  ActiveChatUiBridge,
  type ChatSurfaceActions,
  type SurfaceEnvironment,
  type WelcomeQuoteAdapter,
} from '@pivi/pivi-react/mount';
import type { ChatPerfRecorder } from '@pivi/pivi-react/store';
import { type ChatTabActions, type ChatTabsSnapshot, ChatTabsStore } from '@pivi/pivi-react/store';
import { Notice } from 'obsidian';

import type {
  PiviChatCompositionHost,
  PiviChatHost,
  PiviChatViewHandle,
} from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { createMessagePresentation } from '@/app/ui/imperativeChatMessagePresentation';
import { imperativeChatLogger, runTabAction } from '@/app/ui/imperativeChatTabAction';
import { createImperativeChatViewHandle } from '@/app/ui/imperativeChatViewHandle';
import { QuoteBackgroundController } from '@/ui/chat/controllers/quoteBackground';
import { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabId, TabManagerViewHost } from '@/ui/chat/tabs/types';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '@/ui/shared/utils/animationFrame';

export interface ImperativeChatAdapterDeps {
  plugin: PiviChatCompositionHost;
  view: TabManagerViewHost;
  /** Owning view element used for RAF scheduling and tab-bar portal placement. */
  getContainerEl: () => HTMLElement;
  /** Presentation-only icon resolved by the app composition boundary. */
  chatIcon: ChatTabsSnapshot['chatIcon'];
  /** Debounced persistence owned by the Obsidian view host. */
  persistTabState: (state: ReturnType<TabManager['getPersistedState']>) => void;
  /** Immediate persistence used by close/unload lifecycle paths. */
  persistTabStateImmediate: (state: ReturnType<TabManager['getPersistedState']>) => Promise<void>;
  /** Persisted tab bindings loaded by the Obsidian host lifecycle. */
  loadPersistedTabState: () => Promise<ReturnType<TabManager['getPersistedState']> | null>;
  /** App-owned cross-view navigation; never exposes leaves or managers to chat runtime. */
  activateOpenSessionElsewhere: (openSessionId: string) => Promise<boolean>;
  /** App-owned development instrumentation; disabled no-op in production. */
  perfRecorder: ChatPerfRecorder;
}

export interface CreatedImperativeChatAdapter {
  mount(container: HTMLElement, environment: SurfaceEnvironment, ports: ChatPorts): Promise<void>;
  dispose(): Promise<void>;
  /** Builds the React shell store/bridge/portal before `mountChatView`. */
  prepareShell(ownerDocument: Document): {
    store: ChatTabsStore;
    activeChat: ActiveChatUiBridge;
    inputPortalContainer: HTMLElement;
  };
  getShellActions(): ChatTabActions;
  getSurfaceActions(): ChatSurfaceActions;
  getWelcomeQuoteAdapter(): WelcomeQuoteAdapter;
  getViewHandle(): PiviChatViewHandle;
}

export function createImperativeChatAdapter(
  deps: ImperativeChatAdapterDeps,
): CreatedImperativeChatAdapter {
  const {
    activateOpenSessionElsewhere,
    chatIcon,
    getContainerEl,
    loadPersistedTabState,
    persistTabState,
    persistTabStateImmediate,
    perfRecorder,
    plugin,
    view,
  } = deps;

  let tabManager: TabManager | null = null;
  let mountedPorts: ChatPorts | null = null;
  let chatTabsStore: ChatTabsStore | null = null;
  let activeChatBridge: ActiveChatUiBridge | null = null;
  let inputTabBarPortalEl: HTMLElement | null = null;
  let tabContentEl: HTMLElement | null = null;
  let pendingTabBarUpdate: ScheduledAnimationFrame | null = null;
  let tabPersistenceSuspensions = 0;
  const messageViewports = new Map<TabId, MessageViewportHandle>();
  const chatHost: PiviChatHost = { app: plugin.app };

  const getChatTabsSnapshot = (): ChatTabsSnapshot => ({
    items: tabManager?.getTabBarItems() ?? [],
    position: plugin.settings.tabBarPosition === 'header' ? 'header' : 'input',
    chatIcon,
  });

  const persistCurrentTabState = (): void => {
    if (tabManager && tabPersistenceSuspensions === 0) {
      persistTabState(tabManager.getPersistedState());
    }
  };

  const runWithoutTabPersistence = async <T>(action: () => Promise<T>): Promise<T> => {
    tabPersistenceSuspensions += 1;
    try {
      return await action();
    } finally {
      tabPersistenceSuspensions -= 1;
    }
  };

  const publishTabSnapshot = (): void => {
    chatTabsStore?.update(getChatTabsSnapshot());
  };

  const scheduleTabsSnapshotPublish = (): void => {
    if (!tabManager || !chatTabsStore) return;
    if (pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(pendingTabBarUpdate);
    }
    pendingTabBarUpdate = scheduleAnimationFrame(() => {
      pendingTabBarUpdate = null;
      publishTabSnapshot();
    }, getContainerEl().ownerDocument.defaultView ?? null);
  };

  const syncInputTabBarPortal = (tabId?: TabId | null): void => {
    const portal = inputTabBarPortalEl;
    if (!portal) return;
    if (plugin.settings.tabBarPosition === 'header') {
      portal.remove();
      return;
    }
    const targetTab = tabId ? tabManager?.getTab(tabId) : tabManager?.getActiveTab();
    const target = targetTab?.dom.messagesBottomControlsEl;
    if (target && portal.parentElement !== target) {
      target.appendChild(portal);
    }
  };

  const scrollActiveMessages = (position: 'top' | 'bottom'): void => {
    const tab = tabManager?.getActiveTab();
    if (!tab) return;
    const viewport = messageViewports.get(tab.id);
    if (position === 'top') viewport?.scrollToStart('smooth');
    else viewport?.scrollToEnd('smooth');
  };

  const scrollActiveUserMessage = (direction: 'prev' | 'next'): void => {
    const tab = tabManager?.getActiveTab();
    if (!tab) return;
    messageViewports.get(tab.id)?.scrollToUser(direction);
  };

  const syncActiveChatSurface = (tabId?: TabId | null): void => {
    const tab = tabId ? tabManager?.getTab(tabId) : tabManager?.getActiveTab();
    activeChatBridge?.setActive(
      tab?.state.uiStore ?? null,
      tab?.state.projectionStore ?? null,
      tab
        ? {
            welcome: tab.dom.welcomePortalEl,
            queue: tab.dom.queuePortalEl,
            todo: tab.dom.todoPortalEl,
            navigation: tab.dom.navigationPortalEl,
            messages: tab.dom.messagesPortalEl,
            messagesViewport: tab.dom.messagesEl,
            composer: tab.dom.composerPortalEl,
          }
        : null,
      tab?.ui.composerActions ?? null,
      tab ? createMessagePresentation(tab, (handle) => {
        if (handle) messageViewports.set(tab.id, handle);
        else messageViewports.delete(tab.id);
      }) : null,
    );
  };

  const handleTabClick = (tabId: TabId): void => {
    const switched = tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch((error) => {
        imperativeChatLogger.warn('tab switch failed', error);
        new Notice(t('chat.tabs.failedSwitchTab'));
      });
    }
  };

  const handleTabClose = (tabId: TabId): Promise<void> =>
    runTabAction(async () => {
      const tab = tabManager?.getTab(tabId);
      const force = tab?.state.isStreaming ?? false;
      await tabManager?.closeTab(tabId, force);
      publishTabSnapshot();
    }, 'chat.tabs.failedCloseTab', 'tab close failed');

  const handleTabArchive = (tabId: TabId): Promise<void> =>
    runTabAction(async () => {
      await tabManager?.archiveTab(tabId);
      publishTabSnapshot();
    }, 'chat.tabs.failedArchiveTab', 'tab archive failed');

  const handleTabRenameTitle = (tabId: TabId, title: string): Promise<void> =>
    runTabAction(async () => {
      await tabManager?.renameTabTitle(tabId, title);
      scheduleTabsSnapshotPublish();
      persistCurrentTabState();
    }, 'chat.tabs.failedEditTitle', 'tab title edit failed');

  const startNewChat = (): Promise<void> =>
    runTabAction(async () => {
      const tab = await tabManager?.createTab();
      if (!tab) {
        throw new Error('createTab returned null');
      }
      publishTabSnapshot();
    }, 'chat.tabs.failedCreateChat', 'create chat failed');

  const onTabLifecycle = (): void => {
    scheduleTabsSnapshotPublish();
    syncInputTabBarPortal();
    syncActiveChatSurface();
    persistCurrentTabState();
  };

  const viewHandle = createImperativeChatViewHandle({
    getTabManager: () => tabManager,
    getMountedPorts: () => mountedPorts,
    plugin,
    persistTabStateImmediate: state => tabPersistenceSuspensions === 0
      ? persistTabStateImmediate(state)
      : Promise.resolve(),
    publishTabSnapshot,
    runWithoutTabPersistence,
    syncInputTabBarPortal,
  });

  return {
    prepareShell(ownerDocument) {
      inputTabBarPortalEl = ownerDocument.createElement('div');
      chatTabsStore = new ChatTabsStore(getChatTabsSnapshot());
      activeChatBridge = new ActiveChatUiBridge();
      return {
        store: chatTabsStore,
        activeChat: activeChatBridge,
        inputPortalContainer: inputTabBarPortalEl,
      };
    },

    getShellActions(): ChatTabActions {
      return {
        switchTab: tabId => handleTabClick(tabId),
        archiveTab: tabId => handleTabArchive(tabId),
        renameTab: (tabId, title) => handleTabRenameTitle(tabId, title),
        closeTab: tabId => handleTabClose(tabId),
        startNewChat: () => startNewChat(),
      };
    },

    getSurfaceActions(): ChatSurfaceActions {
      return {
        editQueuedTurn: () => tabManager?.getActiveTab()?.controllers.inputController?.withdrawQueuedMessageToComposer(),
        discardQueuedTurn: () => tabManager?.getActiveTab()?.controllers.inputController?.clearQueuedMessage(),
        scrollToTop: () => scrollActiveMessages('top'),
        scrollToPreviousUserMessage: () => scrollActiveUserMessage('prev'),
        scrollToNextUserMessage: () => scrollActiveUserMessage('next'),
        scrollToBottom: () => scrollActiveMessages('bottom'),
        resumeAutoScroll: () => {
          const active = tabManager?.getActiveTab();
          if (!active) return;
          active.state.autoScrollEnabled = true;
          scrollActiveMessages('bottom');
        },
      };
    },

    getWelcomeQuoteAdapter(): WelcomeQuoteAdapter {
      return {
        mount: (welcomeEl) => {
          const quotes = new QuoteBackgroundController(welcomeEl);
          quotes.start();
          return () => quotes.stop();
        },
      };
    },

    async mount(container, _environment, ports) {
      container.empty();
      tabContentEl = container;
      mountedPorts = ports;

      tabManager = new TabManager(
        chatHost,
        tabContentEl,
        view,
        {
          onTabCreated: onTabLifecycle,
          onTabWillSwitch: (_fromTabId, toTabId) => {
            syncInputTabBarPortal(toTabId);
            syncActiveChatSurface(toTabId);
          },
          onTabSwitched: onTabLifecycle,
          onTabClosed: onTabLifecycle,
          onTabArchived: onTabLifecycle,
          onTabStreamingChanged: () => {
            scheduleTabsSnapshotPublish();
            persistCurrentTabState();
          },
          onTabTitleChanged: () => scheduleTabsSnapshotPublish(),
          onTabAttentionChanged: () => {
            scheduleTabsSnapshotPublish();
            persistCurrentTabState();
          },
          onTabSessionChanged: () => {
            scheduleTabsSnapshotPublish();
            persistCurrentTabState();
          },
        },
        ports,
        activateOpenSessionElsewhere,
        perfRecorder,
      );

      const persistedState = await loadPersistedTabState();
      if (persistedState?.openTabs.length) {
        await tabManager.restoreState(persistedState);
      } else {
        await tabManager.createTab();
      }
      syncInputTabBarPortal();
      syncActiveChatSurface();
      publishTabSnapshot();
      tabManager.prefetchSlashCommandCaches();
    },

    async dispose() {
      if (pendingTabBarUpdate !== null) {
        cancelScheduledAnimationFrame(pendingTabBarUpdate);
        pendingTabBarUpdate = null;
      }

      try {
        await tabManager?.destroy();
      } finally {
        tabManager = null;
        mountedPorts = null;
        activeChatBridge?.dispose();
        activeChatBridge = null;
        messageViewports.clear();

        tabContentEl = null;
        chatTabsStore = null;
        inputTabBarPortalEl?.remove();
        inputTabBarPortalEl = null;
      }
    },

    getViewHandle: () => viewHandle,

  };
}
