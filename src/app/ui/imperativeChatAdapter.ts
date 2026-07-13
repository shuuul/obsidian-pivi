import { recalculateUsageForModel } from '@pivi/obsidian-ui';
import {
  ActiveChatUiBridge,
  type ChatSurfaceActions,
  type ImperativeChatAdapter,
  type MessagePresentationRuntime,
  type WelcomeQuoteAdapter,
} from '@pivi/obsidian-ui/mount';
import { type ChatTabActions, type ChatTabsSnapshot, ChatTabsStore } from '@pivi/obsidian-ui/store';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { getHiddenSlashCommandSet } from '@pivi/pivi-agent-core/foundation/settings';
import { Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { findRedoContext } from '@/ui/chat/branchContext';
import { QuoteBackgroundController } from '@/ui/chat/controllers/quoteBackground';
import {
  getForkEntryId,
  getMessageCopyContent,
  hasPendingAsyncSubagent,
} from '@/ui/chat/rendering/messageRendererActions';
import { renderStoredSubagent } from '@/ui/chat/rendering/SubagentRenderer';
import { renderToolContent } from '@/ui/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/ui/chat/rendering/WriteEditRenderer';
import { refreshBlankTabModelState } from '@/ui/chat/tabs/Tab';
import { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabData, TabId, TabManagerViewHost } from '@/ui/chat/tabs/types';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '@/ui/shared/utils/animationFrame';

export interface ImperativeChatAdapterDeps {
  plugin: PiviChatHost;
  view: TabManagerViewHost;
  /** Owning view element used for RAF scheduling and tab-bar portal placement. */
  getContainerEl: () => HTMLElement;
  /** Debounced persistence owned by the Obsidian view host. */
  persistTabState: () => void;
  /** Restore persisted tabs or create a blank one after TabManager construction. */
  restoreOrCreateTabs: (tabManager: TabManager) => Promise<void>;
}

export interface CreatedImperativeChatAdapter extends ImperativeChatAdapter {
  /** Builds the React shell store/bridge/portal before `mountChatView`. */
  prepareShell(ownerDocument: Document): {
    store: ChatTabsStore;
    activeChat: ActiveChatUiBridge;
    inputPortalContainer: HTMLElement;
  };
  getShellActions(): ChatTabActions;
  getSurfaceActions(): ChatSurfaceActions;
  getWelcomeQuoteAdapter(): WelcomeQuoteAdapter;
  getTabManager(): TabManager | null;
  getActiveTab(): TabData | null;
  refreshModelSelector(): void;
  invalidateSlashCommandCaches(): void;
  prefetchSlashCommandCaches(): void;
  updateHiddenSlashCommands(): void;
  updateLayoutForPosition(): void;
  refreshTabControls(): void;
  createNewTab(): Promise<void>;
}

export function createImperativeChatAdapter(
  deps: ImperativeChatAdapterDeps,
): CreatedImperativeChatAdapter {
  const { plugin, view, getContainerEl, persistTabState, restoreOrCreateTabs } = deps;

  let tabManager: TabManager | null = null;
  let chatTabsStore: ChatTabsStore | null = null;
  let activeChatBridge: ActiveChatUiBridge | null = null;
  let inputTabBarPortalEl: HTMLElement | null = null;
  let tabContentEl: HTMLElement | null = null;
  let messageAdapterGeneration = 0;
  let pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  const getChatTabsSnapshot = (): ChatTabsSnapshot => ({
    items: tabManager?.getTabBarItems() ?? [],
    position: plugin.settings.tabBarPosition === 'header' ? 'header' : 'input',
    chatIcon: plugin.getUiFacades().chatUIConfig.getChatIcon?.() ?? null,
  });

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

  const syncActiveChatSurface = (tabId?: TabId | null): void => {
    const tab = tabId ? tabManager?.getTab(tabId) : tabManager?.getActiveTab();
    activeChatBridge?.setActive(
      tab?.state.uiStore ?? null,
      tab
        ? {
            welcome: tab.dom.welcomePortalEl,
            queue: tab.dom.queuePortalEl,
            todo: tab.dom.todoPortalEl,
            navigation: tab.dom.navigationPortalEl,
            messages: tab.dom.messagesPortalEl,
            composer: tab.dom.composerPortalEl,
          }
        : null,
      tab?.ui.composerActions ?? null,
      tab ? createMessagePresentation(tab) : null,
    );
  };

  const mountMessageContentAdapter = (
    container: HTMLElement,
    generation: string,
    render: (target: HTMLElement) => Promise<void> | void,
  ): (() => void) => {
    const token = `${generation}:${++messageAdapterGeneration}`;
    const staging = container.ownerDocument.createElement('div');
    container.dataset.piviRenderGeneration = token;
    let disposed = false;
    void Promise.resolve(render(staging)).then(() => {
      if (disposed || container.dataset.piviRenderGeneration !== token) return;
      container.replaceChildren(...Array.from(staging.childNodes));
    });
    return () => {
      disposed = true;
      staging.replaceChildren();
      if (container.dataset.piviRenderGeneration !== token) return;
      delete container.dataset.piviRenderGeneration;
      container.replaceChildren();
    };
  };

  const copyMessage = async (tab: TabData, message: ChatMessage): Promise<void> => {
    const content = getMessageCopyContent(message);
    const clipboard = tab.dom.messagesEl.ownerDocument.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) await clipboard.writeText(content);
  };

  const createMessagePresentation = (tab: TabData): MessagePresentationRuntime => ({
    actions: {
      canCopy: message => getMessageCopyContent(message).length > 0,
      canFork: message => !!getForkEntryId(message) && !hasPendingAsyncSubagent(message),
      canRedo: messageId => {
        const index = tab.state.messages.findIndex(message => message.id === messageId);
        const message = tab.state.messages[index];
        return !!message
          && findRedoContext(tab.state.messages, index) !== null
          && !hasPendingAsyncSubagent(message);
      },
      copy: message => copyMessage(tab, message),
      fork: messageId => tab.renderer?.forkCallback?.(messageId),
      redo: messageId => tab.renderer?.redoCallback?.(messageId),
      scrollToRecentUser: () => scrollActiveUserMessage('prev'),
    },
    contentAdapters: {
      markdown: {
        mount: (container, markdown, context) => mountMessageContentAdapter(
          container,
          context.generation,
          target => tab.renderer?.renderContent(target, markdown),
        ),
      },
      userContent: {
        mount: (container, message, context) => {
          const text = message.displayContent ?? message.content;
          return mountMessageContentAdapter(
            container,
            context.generation,
            target => text
              ? tab.renderer?.renderUserMessageText(target, text, message.turnRequest)
              : undefined,
          );
        },
      },
      tool: {
        mount: (container, toolCall) => {
          renderToolContent(container, toolCall);
          return () => container.empty();
        },
      },
      diff: {
        mount: (container, toolCall) => {
          renderStoredWriteEdit(container, toolCall);
          return () => container.empty();
        },
      },
      askUser: {
        mount: (container, toolCall) => {
          renderToolContent(container, toolCall);
          return () => container.empty();
        },
      },
      subagent: {
        mount: (container, subagent) => {
          renderStoredSubagent(
            container,
            subagent,
            async (target, markdown) => {
              await tab.renderer?.renderContent(target, markdown);
            },
          );
          return () => container.empty();
        },
      },
    },
  });

  const scrollActiveMessages = (position: 'top' | 'bottom'): void => {
    const messages = tabManager?.getActiveTab()?.dom.messagesEl;
    if (!messages) return;
    messages.scrollTo({ top: position === 'top' ? 0 : messages.scrollHeight, behavior: 'smooth' });
  };

  const scrollActiveUserMessage = (direction: 'prev' | 'next'): void => {
    const messages = tabManager?.getActiveTab()?.dom.messagesEl;
    if (!messages) return;
    const userMessages = Array.from(messages.querySelectorAll<HTMLElement>('.pivi-message-user'));
    const threshold = 30;
    if (direction === 'prev') {
      for (let index = userMessages.length - 1; index >= 0; index--) {
        const message = userMessages[index];
        if (message && message.offsetTop < messages.scrollTop - threshold) {
          messages.scrollTo({ top: message.offsetTop - 10, behavior: 'smooth' });
          return;
        }
      }
      scrollActiveMessages('top');
      return;
    }
    for (const message of userMessages) {
      if (message.offsetTop > messages.scrollTop + threshold) {
        messages.scrollTo({ top: message.offsetTop - 10, behavior: 'smooth' });
        return;
      }
    }
    scrollActiveMessages('bottom');
  };

  const handleTabClick = (tabId: TabId): void => {
    const switched = tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice(t('chat.tabs.failedSwitchTab')));
    }
  };

  const handleTabClose = async (tabId: TabId): Promise<void> => {
    try {
      const tab = tabManager?.getTab(tabId);
      const force = tab?.state.isStreaming ?? false;
      await tabManager?.closeTab(tabId, force);
      publishTabSnapshot();
    } catch {
      new Notice(t('chat.tabs.failedCloseTab'));
    }
  };

  const handleTabArchive = async (tabId: TabId): Promise<void> => {
    try {
      await tabManager?.archiveTab(tabId);
      publishTabSnapshot();
    } catch {
      new Notice(t('chat.tabs.failedArchiveTab'));
    }
  };

  const handleTabRenameTitle = async (tabId: TabId, title: string): Promise<void> => {
    try {
      await tabManager?.renameTabTitle(tabId, title);
      scheduleTabsSnapshotPublish();
      persistTabState();
    } catch {
      new Notice(t('chat.tabs.failedEditTitle'));
    }
  };

  const startNewChat = async (): Promise<void> => {
    try {
      const tab = await tabManager?.createTab();
      if (!tab) {
        new Notice(t('chat.tabs.failedCreateChat'));
      }
      publishTabSnapshot();
    } catch {
      new Notice(t('chat.tabs.failedCreateChat'));
    }
  };

  const onTabLifecycle = (): void => {
    scheduleTabsSnapshotPublish();
    syncInputTabBarPortal();
    syncActiveChatSurface();
    persistTabState();
  };

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

      tabManager = new TabManager(
        plugin,
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
            persistTabState();
          },
          onTabTitleChanged: () => scheduleTabsSnapshotPublish(),
          onTabAttentionChanged: () => {
            scheduleTabsSnapshotPublish();
            persistTabState();
          },
          onTabSessionChanged: () => {
            scheduleTabsSnapshotPublish();
            persistTabState();
          },
        },
        ports,
      );

      await restoreOrCreateTabs(tabManager);
      syncInputTabBarPortal();
      syncActiveChatSurface();
      publishTabSnapshot();
      tabManager.primeAgentRuntime();
    },

    async dispose() {
      if (pendingTabBarUpdate !== null) {
        cancelScheduledAnimationFrame(pendingTabBarUpdate);
        pendingTabBarUpdate = null;
      }

      await tabManager?.destroy();
      tabManager = null;
      activeChatBridge?.dispose();
      activeChatBridge = null;

      tabContentEl = null;
      chatTabsStore = null;
      inputTabBarPortalEl?.remove();
      inputTabBarPortalEl = null;
    },

    getTabManager: () => tabManager,
    getActiveTab: () => tabManager?.getActiveTab() ?? null,

    refreshModelSelector() {
      const ports = tabManager?.getChatPorts();
      for (const tab of tabManager?.getAllTabs() ?? []) {
        if (ports) {
          refreshBlankTabModelState(tab, plugin, ports);
        }
        const uiFacades = plugin.getUiFacades();
        const providerSettings = uiFacades.getSettingsSnapshot(plugin.settings);
        const model = providerSettings.model;
        const contextWindow = uiFacades.chatUIConfig.getContextWindowSize(
          model,
          providerSettings.customContextLimits,
        );

        if (tab.state.usage) {
          tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
        }

        tab.ui.composerActions?.refresh();
      }

      tabManager?.primeAgentRuntime();
    },

    invalidateSlashCommandCaches() {
      tabManager?.invalidateSlashCommandCaches();
    },

    prefetchSlashCommandCaches() {
      tabManager?.prefetchSlashCommandCaches();
    },

    updateHiddenSlashCommands() {
      const hidden = getHiddenSlashCommandSet(plugin.settings);
      for (const tab of tabManager?.getAllTabs() ?? []) {
        tab.ui.slashCommandDropdown?.setHiddenCommands(hidden);
      }
    },

    updateLayoutForPosition() {
      syncInputTabBarPortal();
      publishTabSnapshot();
    },

    refreshTabControls() {
      publishTabSnapshot();
    },

    async createNewTab() {
      const tab = await tabManager?.createTab();
      if (!tab) {
        new Notice(t('chat.tabs.failedCreateTab'));
        publishTabSnapshot();
        return;
      }
      publishTabSnapshot();
    },
  };
}
