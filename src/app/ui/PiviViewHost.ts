import { recalculateUsageForModel } from '@pivi/obsidian-ui';
import {
  ActiveChatUiBridge,
  type MessagePresentationRuntime,
  mountChatView,
  type MountedSurface,
} from '@pivi/obsidian-ui/mount';
import { type ChatTabsSnapshot, ChatTabsStore } from '@pivi/obsidian-ui/store';
import { type ChatMessage, VIEW_TYPE_PIVI } from '@pivi/pivi-agent-core/foundation';
import { getHiddenSlashCommandSet } from '@pivi/pivi-agent-core/foundation/settings';
import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { appI18n, t } from '@/app/i18n';
import { createChatUiPorts } from '@/app/ui/createUiPorts';
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
import type { TabData, TabId } from '@/ui/chat/tabs/types';
import { getActiveWindow } from '@/ui/shared/dom';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '@/ui/shared/utils/animationFrame';
type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class PiviViewHost extends ItemView {
  private plugin: PiviChatHost;
  private mountedSurface: MountedSurface | null = null;

  // Tab management
  private tabManager: TabManager | null = null;
  private chatTabsStore: ChatTabsStore | null = null;
  private activeChatBridge: ActiveChatUiBridge | null = null;
  private tabContentEl: HTMLElement | null = null;
  private inputTabBarPortalEl: HTMLElement | null = null;
  private messageAdapterGeneration = 0;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PiviChatHost) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches PiviViewHost.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this);
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_PIVI;
  }

  getDisplayText(): string {
    return 'Pivi';
  }

  getIcon(): string {
    return 'pivi-p';
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      refreshBlankTabModelState(tab, this.plugin);
      const uiFacades = this.plugin.getUiFacades();
      const providerSettings = uiFacades.getSettingsSnapshot(
        this.plugin.settings,
      );
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

    this.tabManager?.primeAgentRuntime();
  }

  invalidateSlashCommandCaches(): void {
    this.tabManager?.invalidateSlashCommandCaches();
  }

  prefetchSlashCommandCaches(): void {
    this.tabManager?.prefetchSlashCommandCaches();
  }

  /** Updates hidden slash commands on all tabs after settings changes. */
  updateHiddenSlashCommands(): void {
    const hidden = getHiddenSlashCommandSet(this.plugin.settings);
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(hidden);
    }
  }

  async onOpen(): Promise<void> {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    await this.mountedSurface?.dispose();
    const ownerDocument = container.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) {
      throw new Error('Pivi chat view has no owning window.');
    }
    container.empty();
    this.inputTabBarPortalEl = ownerDocument.createElement('div');
    this.chatTabsStore = new ChatTabsStore(this.getChatTabsSnapshot());
    this.activeChatBridge = new ActiveChatUiBridge();
    this.mountedSurface = await mountChatView({
      container,
      ownerDocument,
      ownerWindow,
      portalContainer: ownerDocument.body,
      i18n: appI18n,
      ports: createChatUiPorts(this.plugin),
      chatShell: {
        store: this.chatTabsStore,
        actions: {
          switchTab: (tabId) => this.handleTabClick(tabId),
          archiveTab: (tabId) => this.handleTabArchive(tabId),
          renameTab: (tabId, title) => this.handleTabRenameTitle(tabId, title),
          closeTab: (tabId) => this.handleTabClose(tabId),
          startNewChat: () => this.startNewChat(),
        },
        inputPortalContainer: this.inputTabBarPortalEl,
        activeChat: this.activeChatBridge,
        surfaceActions: {
          editQueuedTurn: () => this.tabManager?.getActiveTab()?.controllers.inputController?.withdrawQueuedMessageToComposer(),
          discardQueuedTurn: () => this.tabManager?.getActiveTab()?.controllers.inputController?.clearQueuedMessage(),
          scrollToTop: () => this.scrollActiveMessages('top'),
          scrollToPreviousUserMessage: () => this.scrollActiveUserMessage('prev'),
          scrollToNextUserMessage: () => this.scrollActiveUserMessage('next'),
          scrollToBottom: () => this.scrollActiveMessages('bottom'),
          resumeAutoScroll: () => {
            const active = this.tabManager?.getActiveTab();
            if (!active) return;
            active.state.autoScrollEnabled = true;
            this.scrollActiveMessages('bottom');
          },
        },
        welcomeQuoteAdapter: {
          mount: (welcomeEl) => {
            const quotes = new QuoteBackgroundController(welcomeEl);
            quotes.start();
            return () => quotes.stop();
          },
        },
      },
      imperativeAdapter: {
        mount: container => this.mountChatRuntimeSurface(container),
        dispose: () => this.disposeChatRuntimeSurface(),
      },
    });
  }

  private syncActiveChatSurface(tabId?: TabId | null): void {
    const tab = tabId ? this.tabManager?.getTab(tabId) : this.tabManager?.getActiveTab();
    this.activeChatBridge?.setActive(
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
      tab ? this.createMessagePresentation(tab) : null,
    );
  }

  private createMessagePresentation(tab: TabData): MessagePresentationRuntime {
    return {
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
        copy: message => this.copyMessage(tab, message),
        fork: messageId => tab.renderer?.forkCallback?.(messageId),
        redo: messageId => tab.renderer?.redoCallback?.(messageId),
        scrollToRecentUser: () => this.scrollActiveUserMessage('prev'),
      },
      contentAdapters: {
        markdown: {
          mount: (container, markdown, context) => this.mountMessageContentAdapter(
            container,
            context.generation,
            target => tab.renderer?.renderContent(target, markdown),
          ),
        },
        userContent: {
          mount: (container, message, context) => {
            const text = message.displayContent ?? message.content;
            return this.mountMessageContentAdapter(
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
    };
  }
  private mountMessageContentAdapter(
    container: HTMLElement,
    generation: string,
    render: (target: HTMLElement) => Promise<void> | void,
  ): () => void {
    const token = `${generation}:${++this.messageAdapterGeneration}`;
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
  }


  private async copyMessage(tab: TabData, message: ChatMessage): Promise<void> {
    const content = getMessageCopyContent(message);
    const clipboard = tab.dom.messagesEl.ownerDocument.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) await clipboard.writeText(content);
  }

  private scrollActiveMessages(position: 'top' | 'bottom'): void {
    const messages = this.tabManager?.getActiveTab()?.dom.messagesEl;
    if (!messages) return;
    messages.scrollTo({ top: position === 'top' ? 0 : messages.scrollHeight, behavior: 'smooth' });
  }

  private scrollActiveUserMessage(direction: 'prev' | 'next'): void {
    const messages = this.tabManager?.getActiveTab()?.dom.messagesEl;
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
      this.scrollActiveMessages('top');
      return;
    }
    for (const message of userMessages) {
      if (message.offsetTop > messages.scrollTop + threshold) {
        messages.scrollTo({ top: message.offsetTop - 10, behavior: 'smooth' });
        return;
      }
    }
    this.scrollActiveMessages('bottom');
  }

  private async mountChatRuntimeSurface(container: HTMLElement): Promise<void> {
    container.empty();
    this.tabContentEl = container;

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.syncInputTabBarPortal();
          this.syncActiveChatSurface();
          this.persistTabState();
        },
        onTabWillSwitch: (_fromTabId, toTabId) => {
          this.syncInputTabBarPortal(toTabId);
          this.syncActiveChatSurface(toTabId);
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.syncInputTabBarPortal();
          this.syncActiveChatSurface();
          this.persistTabState();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.syncInputTabBarPortal();
          this.syncActiveChatSurface();
          this.persistTabState();
        },
        onTabArchived: () => {
          this.updateTabBar();
          this.syncInputTabBarPortal();
          this.syncActiveChatSurface();
          this.persistTabState();
        },
        onTabStreamingChanged: () => {
          this.updateTabBar();
          this.persistTabState();
        },
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => {
          this.updateTabBar();
          this.persistTabState();
        },
        onTabSessionChanged: () => {
          this.updateTabBar();
          this.persistTabState();
        },
      }
    );

    this.wireEventHandlers();
    await this.restoreOrCreateTabs();
    this.syncInputTabBarPortal();
    this.syncActiveChatSurface();
    this.publishTabSnapshot();
    this.tabManager?.primeAgentRuntime();
  }

  async onClose(): Promise<void> {
    const mountedSurface = this.mountedSurface;
    this.mountedSurface = null;
    if (mountedSurface) {
      await mountedSurface.dispose();
      return;
    }
    await this.disposeChatRuntimeSurface();
  }

  private async disposeChatRuntimeSurface(): Promise<void> {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    await this.persistTabStateImmediate();

    await this.tabManager?.destroy();
    this.tabManager = null;
    this.activeChatBridge?.dispose();
    this.activeChatBridge = null;

    this.scope = null;
    this.tabContentEl = null;
    this.chatTabsStore = null;
    this.inputTabBarPortalEl?.remove();
    this.inputTabBarPortalEl = null;
  }

  /**
   * Updates layout when tabBarPosition setting changes.
   * Called from settings when user changes the tab bar position.
   */
  updateLayoutForPosition(): void {
    this.syncInputTabBarPortal();
    this.publishTabSnapshot();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.publishTabSnapshot();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice(t('chat.tabs.failedSwitchTab')));
    }
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      const tab = this.tabManager?.getTab(tabId);
      // If streaming, treat close like user interrupt (force close cancels the stream)
      const force = tab?.state.isStreaming ?? false;
      await this.tabManager?.closeTab(tabId, force);
      this.updateTabBarVisibility();
    } catch {
      new Notice(t('chat.tabs.failedCloseTab'));
    }
  }

  private async handleTabArchive(tabId: TabId): Promise<void> {
    try {
      await this.tabManager?.archiveTab(tabId);
      this.updateTabBarVisibility();
    } catch {
      new Notice(t('chat.tabs.failedArchiveTab'));
    }
  }

  private async handleTabRenameTitle(tabId: TabId, title: string): Promise<void> {
    try {
      await this.tabManager?.renameTabTitle(tabId, title);
      this.updateTabBar();
      this.persistTabState();
    } catch {
      new Notice(t('chat.tabs.failedEditTitle'));
    }
  }

  private async startNewChat(): Promise<void> {
    try {
      const tab = await this.tabManager?.createTab();
      if (!tab) {
        new Notice(t('chat.tabs.failedCreateChat'));
      }
      this.updateTabBarVisibility();
    } catch {
      new Notice(t('chat.tabs.failedCreateChat'));
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      new Notice(t('chat.tabs.failedCreateTab'));
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.chatTabsStore) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      this.publishTabSnapshot();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    this.publishTabSnapshot();
  }

  /** Moves one stable React portal container without remounting the tab bar subtree. */
  private syncInputTabBarPortal(tabId?: TabId | null): void {
    const portal = this.inputTabBarPortalEl;
    if (!portal) return;
    if (this.plugin.settings.tabBarPosition === 'header') {
      portal.remove();
      return;
    }

    const targetTab = tabId
      ? this.tabManager?.getTab(tabId)
      : this.tabManager?.getActiveTab();
    const target = targetTab?.dom.messagesBottomControlsEl;
    if (target && portal.parentElement !== target) {
      target.appendChild(portal);
    }
  }

  private getChatTabsSnapshot(): ChatTabsSnapshot {
    return {
      items: this.tabManager?.getTabBarItems() ?? [],
      position: this.plugin.settings.tabBarPosition === 'header' ? 'header' : 'input',
      chatIcon: this.plugin.getUiFacades().chatUIConfig.getChatIcon?.() ?? null,
    };
  }

  private publishTabSnapshot(): void {
    this.chatTabsStore?.update(this.getChatTabsSnapshot());
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.registerEvent(this.plugin.app.vault.on('create', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('delete', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('rename', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('modify', () => markCacheDirty(false)));

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.richInput.el) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    const win = getActiveWindow(this.containerEl);
    if (this.pendingPersist !== null) {
      win.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = win.setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      getActiveWindow(this.containerEl).clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }
}
