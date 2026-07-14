import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { recalculateUsageForModel } from '@pivi/pivi-agent-core/foundation/usage';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import {
  ActiveChatUiBridge,
  type ChatSurfaceActions,
  type MessagePresentationRuntime,
  type SurfaceEnvironment,
  type WelcomeQuoteAdapter,
} from '@pivi/pivi-react/mount';
import { type ChatTabActions, type ChatTabsSnapshot, ChatTabsStore } from '@pivi/pivi-react/store';
import { type Editor, type MarkdownView, Notice, type TFile } from 'obsidian';

import type {
  PiviChatCompositionHost,
  PiviChatHost,
  PiviChatViewHandle,
} from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { createSubagentContentAdapter } from '@/app/ui/createSubagentContentAdapter';
import { findRedoContext } from '@/ui/chat/branchContext';
import { QuoteBackgroundController } from '@/ui/chat/controllers/quoteBackground';
import {
  getForkEntryId,
  getMessageCopyContent,
  hasPendingAsyncSubagent,
} from '@/ui/chat/rendering/messageRendererActions';
import { renderToolContent } from '@/ui/chat/rendering/ToolCallRenderer';
import { refreshBlankTabModelState } from '@/ui/chat/tabs/Tab';
import { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabData, TabId, TabManagerViewHost } from '@/ui/chat/tabs/types';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '@/ui/shared/utils/animationFrame';
import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

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
    plugin,
    view,
  } = deps;

  let tabManager: TabManager | null = null;
  let mountedPorts: ChatPorts | null = null;
  let chatTabsStore: ChatTabsStore | null = null;
  let activeChatBridge: ActiveChatUiBridge | null = null;
  let inputTabBarPortalEl: HTMLElement | null = null;
  let tabContentEl: HTMLElement | null = null;
  let messageAdapterGeneration = 0;
  let pendingTabBarUpdate: ScheduledAnimationFrame | null = null;
  const chatHost: PiviChatHost = { app: plugin.app };

  const getChatTabsSnapshot = (): ChatTabsSnapshot => ({
    items: tabManager?.getTabBarItems() ?? [],
    position: plugin.settings.tabBarPosition === 'header' ? 'header' : 'input',
    chatIcon,
  });

  const persistCurrentTabState = (): void => {
    if (tabManager) persistTabState(tabManager.getPersistedState());
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
        mount: (container, toolCall, context) => mountMessageContentAdapter(
          container,
          context.generation,
          target => renderToolContent(target, toolCall, undefined, {
            renderMarkdown: (preview, markdown, sourcePath) => (
              tab.renderer?.renderContent(preview, markdown, { sourcePath }) ?? Promise.resolve()
            ),
          }),
        ),
      },
      askUser: {
        mount: (container, toolCall) => {
          void renderToolContent(container, toolCall);
          return () => container.empty();
        },
      },
      subagent: createSubagentContentAdapter(async (target, markdown, options) => {
        await tab.renderer?.renderContent(target, markdown, options);
      }),
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
      persistCurrentTabState();
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
    persistCurrentTabState();
  };

  const refreshModelPresentation = (): void => {
    const ports = mountedPorts;
    if (!ports) return;
    const settings = ports.settings.getSettingsSnapshot();
    const contextWindow = ports.models.getContextWindowSize(
      settings.model,
      settings.customContextLimits,
    );

    for (const tab of tabManager?.getAllTabs() ?? []) {
      refreshBlankTabModelState(tab, ports);
      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(
          tab.state.usage,
          settings.model,
          contextWindow,
        );
      }
      tab.ui.composerActions?.refresh();
    }
    tabManager?.prefetchSlashCommandCaches();
  };

  const viewHandle: PiviChatViewHandle = {
    commands: {
      getState: () => {
        const activeTab = tabManager?.getActiveTab() ?? null;
        return {
          mounted: tabManager !== null,
          canCreateTab: tabManager?.canCreateTab() ?? false,
          canStartNewSession: !!activeTab && !activeTab.state.isStreaming,
          canCloseActiveTab: activeTab !== null,
        };
      },
      async createTab() {
        const tab = await tabManager?.createTab();
        publishTabSnapshot();
        return tab != null;
      },
      async startNewSession() {
        const activeTab = tabManager?.getActiveTab() ?? null;
        if (!activeTab || activeTab.state.isStreaming) return false;
        await tabManager?.createNewSession();
        return true;
      },
      async closeActiveTab() {
        const manager = tabManager;
        const tabId = manager?.getActiveTabId() ?? null;
        if (!manager || !tabId) return false;
        const closed = await manager.closeTab(tabId);
        publishTabSnapshot();
        return closed;
      },
      cancelActiveTurn() {
        const tab = tabManager?.getActiveTab() ?? null;
        if (!tab?.state.isStreaming || !tab.controllers.inputController) return false;
        tab.controllers.inputController.cancelStreaming();
        return true;
      },
      addEditorSelection(editor: Editor, markdownView: MarkdownView) {
        return tabManager?.getActiveTab()?.ui.inlineContextManager
          ?.addSelectionFromEditor(editor, markdownView) ?? false;
      },
      getInlineEditModel() {
        const tab = tabManager?.getActiveTab() ?? null;
        return tab?.service?.getAuxiliaryModel?.() ?? tab?.draftModel ?? null;
      },
      getActiveExternalContexts() {
        return [
          ...(tabManager?.getActiveTab()?.ui.externalContextSelector
            ?.getExternalContexts() ?? []),
        ];
      },
    },
    maintenance: {
      async persistState() {
        if (!tabManager) return;
        await persistTabStateImmediate(tabManager.getPersistedState());
      },
      async resetSession(openSessionId) {
        for (const tab of tabManager?.getAllTabs() ?? []) {
          if (tab.openSessionId !== openSessionId) continue;
          if (tab.state.isStreaming) {
            tab.controllers.inputController?.cancelStreaming();
          }
          await tab.controllers.openSessionController?.createNew({ force: true });
        }
      },
      getBoundSessionFiles() {
        return [
          ...new Set(
            (tabManager?.getAllTabs() ?? [])
              .map(tab => tab.sessionFile)
              .filter((path): path is string => !!path),
          ),
        ];
      },
      hasSession(openSessionId) {
        return (tabManager?.getAllTabs() ?? [])
          .some(tab => tab.openSessionId === openSessionId);
      },
      async activateSession(openSessionId) {
        const tab = (tabManager?.getAllTabs() ?? [])
          .find(candidate => candidate.openSessionId === openSessionId);
        if (!tab || !tabManager) return false;
        await tabManager.switchToTab(tab.id);
        return true;
      },
      refreshModelPresentation,
      refreshTabBarPosition() {
        syncInputTabBarPortal();
        publishTabSnapshot();
      },
      async refreshRuntimePrompt() {
        await tabManager?.broadcastToAllTabs(async service => {
          if (service.syncSystemPrompt) await service.syncSystemPrompt();
          else await service.ensureReady({ force: true });
        });
      },
      async reloadMcpServers() {
        await tabManager?.broadcastToAllTabs(service => service.reloadMcpServers());
      },
      async refreshVaultSkills() {
        tabManager?.invalidateSlashCommandCaches();
        await tabManager?.broadcastToAllTabs(async service => {
          await service.syncSystemPrompt?.();
        });
      },
      invalidateSlashCatalog() {
        tabManager?.invalidateSlashCommandCaches();
      },
      warmSlashCatalog() {
        tabManager?.prefetchSlashCommandCaches();
      },
      syncExternalReadDirectories(paths) {
        tabManager?.syncPinnedExternalContextPaths([...paths]);
      },
      async applyEnvironmentRuntimeChange(modelChanged) {
        const tabs = tabManager?.getAllTabs() ?? [];
        for (const tab of tabs) {
          if (tab.state.isStreaming) {
            tab.controllers.inputController?.cancelStreaming();
          }
        }

        let failedTabs = 0;
        for (const tab of tabs) {
          const service = tab.service;
          if (!service || !tab.serviceInitialized) continue;
          try {
            const externalContexts = tab.ui.externalContextSelector?.getExternalContexts()
              ?? getDefaultExternalContextPaths(plugin.settings);
            service.syncSession(
              tab.sessionFile ? { sessionFile: tab.sessionFile } : null,
              externalContexts,
            );
            if (modelChanged) {
              service.resetSession();
              await service.ensureReady();
            } else {
              await service.ensureReady({ force: true });
            }
          } catch (error) {
            console.warn('Pivi: tab failed to restart after environment change', error);
            failedTabs++;
          }
        }
        return { failedTabs };
      },
      markFileContextDirty(includesFolders) {
        const manager = tabManager?.getActiveTab()?.ui.fileContextManager;
        if (!manager) return;
        manager.markFileCacheDirty();
        if (includesFolders) manager.markFolderCacheDirty();
      },
      handleFileOpen(file: TFile) {
        tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
      },
      dismissMentionDropdown(target: Node) {
        const tab = tabManager?.getActiveTab() ?? null;
        const manager = tab?.ui.fileContextManager;
        if (!tab || !manager) return;
        if (!manager.containsElement(target) && target !== tab.dom.richInput.el) {
          manager.hideMentionDropdown();
        }
      },
    },
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

        tabContentEl = null;
        chatTabsStore = null;
        inputTabBarPortalEl?.remove();
        inputTabBarPortalEl = null;
      }
    },

    getViewHandle: () => viewHandle,

  };
}
