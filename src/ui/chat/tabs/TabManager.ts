import type { PiChatService } from '@pivi/pivi-agent-core/runtime';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import {
  type ChatPerfRecorder,
  NOOP_CHAT_PERF_RECORDER,
} from '@pivi/pivi-react/store';

import type { PiviChatHost } from '@/app/hostContracts';

import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  initializeTabUI,
} from './Tab';
import { initializeTabControllers } from './tabControllerInit';
import { syncTabSessionExternalContext } from './tabExternalContext';
import type { ForkContext } from './tabFork';
import { wireTabInputEvents } from './tabInputWiring';
import { broadcastToTabs } from './tabManagerBroadcast';
import {
  forkToNewTab as forkToNewTabHelper,
  handleForkRequest,
} from './tabManagerFork';
import { openSessionInTabManager } from './tabManagerOpenSession';
import {
  getPersistedState as buildPersistedState,
  restoreState as restorePersistedState,
} from './tabManagerPersist';
import { getTabBarItems as buildTabBarItems } from './tabManagerTabBar';
import { TabRuntimeRegistry } from './TabRuntimeRegistry';
import {
  type PersistedTabManagerState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabManagerCallbacks,
  type TabManagerViewHost,
} from './types';

type CreateTabOptions = {
  activate?: boolean;
  draftModel?: string;
  draftTitle?: string;
  sessionFile?: string | null;
  isArchived?: boolean;
  needsAttention?: boolean;
};

type OpenSessionOptions = {
  preferNewTab?: boolean;
  activate?: boolean;
};

/**
 * TabManager coordinates multiple chat tabs.
 */
export class TabManager {
  private plugin: PiviChatHost;
  private containerEl: HTMLElement;
  private view: TabManagerViewHost;
  private ports: ChatPorts;
  private activateOpenSessionElsewhere: (openSessionId: string) => Promise<boolean>;
  private perfRecorder: ChatPerfRecorder;

  private tabs = new TabRuntimeRegistry();
  private activeTabId: TabId | null = null;
  private callbacks: TabManagerCallbacks;
  private isRestoringState = false;

  /** Guard to prevent concurrent tab switches. */
  private isSwitchingTab = false;
  private switchingPromise: Promise<void> | null = null;

  constructor(
    plugin: PiviChatHost,
    containerEl: HTMLElement,
    view: TabManagerViewHost,
    callbacks: TabManagerCallbacks = {},
    ports: ChatPorts,
    activateOpenSessionElsewhere: (openSessionId: string) => Promise<boolean> = () => Promise.resolve(false),
    perfRecorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER,
  ) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.view = view;
    this.callbacks = callbacks;
    this.ports = ports;
    this.activateOpenSessionElsewhere = activateOpenSessionElsewhere;
    this.perfRecorder = perfRecorder;
  }

  // ============================================
  // Tab Lifecycle
  // ============================================

  /**
   * Creates a new tab.
   * @param openSessionId Optional session to load into the tab.
   * @param tabId Optional tab ID (for restoration).
   * @param options Controls whether the new tab becomes active immediately.
   * @returns The created tab.
   */
  async createTab(
    openSessionId?: string | null,
    tabId?: TabId,
    options: CreateTabOptions = {},
  ): Promise<TabData | null> {
    const { activate = true, draftModel, draftTitle, isArchived, needsAttention, sessionFile } = options;

    if (this.shouldReuseActiveBlankTab(openSessionId, tabId, options)) {
      return this.getActiveTab();
    }

    let openSession = openSessionId
      ? await this.ports.sessions.getOpenSession(openSessionId)
      : undefined;

    if (!openSession && sessionFile) {
      openSession = await this.ports.sessions.openSessionFile(sessionFile);
    }

    const tab = createTab({
      plugin: this.plugin,
      ports: this.ports,
      containerEl: this.containerEl,
      openSession: openSession ?? undefined,
      tabId,
      ...(typeof draftModel === 'string' ? { draftModel } : {}),
      ...(typeof draftTitle === 'string' ? { draftTitle } : {}),
      ...(isArchived ? { isArchived } : {}),
      ...(needsAttention ? { needsAttention } : {}),
      onStreamingChanged: (isStreaming) => {
        if (!isStreaming && tab.id !== this.activeTabId) {
          tab.state.needsAttention = true;
        }
        this.callbacks.onTabStreamingChanged?.(tab.id, isStreaming);
      },
      onAttentionChanged: (needsAttention) => {
        this.callbacks.onTabAttentionChanged?.(tab.id, needsAttention);
      },
      onOpenSessionIdChanged: (openSessionId) => {
        // Sync tab.openSessionId when openSession is lazily created
        tab.openSessionId = openSessionId;
        const conv = openSessionId ? this.ports.sessions.findOpenSession(openSessionId) : null;
        tab.sessionFile = conv?.sessionFile ?? tab.sessionFile;
        tab.leafId = null;
        // Safety net: apply blank-tab custom title when a session binds outside title coordinator.
        if (openSessionId && tab.draftTitle?.trim()) {
          const title = tab.draftTitle.trim();
          tab.draftTitle = null;
          void this.ports.sessions.renameSession(openSessionId, title, 'custom').then(() => {
            this.callbacks.onTabTitleChanged?.(tab.id, title);
          });
        }
        this.callbacks.onTabSessionChanged?.(tab.id, openSessionId);
      },
      perfRecorder: this.perfRecorder,
    });

    const getSlashCatalogConfig = () => ({
      config: this.ports.catalog.getSlashDropdownConfig(),
      getEntries: () => this.ports.catalog.listSlashEntries(true),
    });

    // Initialize UI components with provider catalog
    initializeTabUI(tab, this.plugin, { ports: this.ports, getSlashCatalogConfig });

    initializeTabControllers(
      tab,
      this.plugin,
      this.view,
      this.ports,
      (forkContext) => this.handleForkRequest(forkContext),
      (openSessionId) => this.openSession(openSessionId),
      getSlashCatalogConfig,
      (title) => {
        this.callbacks.onTabTitleChanged?.(tab.id, title);
      },
    );

    // Wire input event handlers
    wireTabInputEvents(tab, this.ports.settings);

    this.tabs.set(tab.id, tab);
    this.callbacks.onTabCreated?.(tab);

    if (!this.isRestoringState && (activate || !this.activeTabId)) {
      await this.switchToTab(tab.id);
    }

    return tab;
  }

  private shouldReuseActiveBlankTab(
    openSessionId: string | null | undefined,
    tabId: TabId | undefined,
    options: CreateTabOptions,
  ): boolean {
    if (this.isRestoringState || tabId || openSessionId || options.sessionFile || options.isArchived) {
      return false;
    }

    const activeTab = this.getActiveTab();
    if (!activeTab || activeTab.openSessionId || activeTab.state.messages.length > 0 || activeTab.state.isStreaming) {
      return false;
    }

    if (activeTab.ui.imageContextManager?.hasImages()) {
      return false;
    }

    const draftText = activeTab.dom.richInput?.value?.trim() ?? '';
    return draftText.length === 0;
  }

  /**
   * Switches to a different tab.
   * @param tabId The tab to switch to.
   */
  async switchToTab(tabId: TabId): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    if (this.isSwitchingTab) {
      await this.switchingPromise;
      return;
    }

    this.isSwitchingTab = true;
    let resolveSwitch: () => void = () => {};
    let rejectSwitch: (reason?: unknown) => void = () => {};
    this.switchingPromise = new Promise<void>((resolve, reject) => {
      resolveSwitch = resolve;
      rejectSwitch = reject;
    });
    const previousTabId = this.activeTabId;

    try {
      this.callbacks.onTabWillSwitch?.(previousTabId, tabId);

      // Deactivate current tab
      if (previousTabId && previousTabId !== tabId) {
        const currentTab = this.tabs.get(previousTabId);
        if (currentTab) {
          currentTab.state.flushProjection();
          deactivateTab(currentTab);
        }
      }

      // Activate new tab
      this.activeTabId = tabId;
      this.unarchiveTabForActivation(tab);
      tab.state.needsAttention = false;
      activateTab(tab);

      // Load openSession if not already loaded
      if (tab.openSessionId && tab.state.messages.length === 0) {
        await tab.controllers.openSessionController?.switchTo(
          tab.openSessionId,
        );
      } else if (
        !tab.openSessionId &&
        tab.sessionFile &&
        tab.state.messages.length === 0
      ) {
        const openSession = await this.ports.sessions.openSessionFile(tab.sessionFile);
        if (openSession) {
          tab.openSessionId = openSession.id;
          syncTabSessionExternalContext(
            tab,
            { sessionFile: openSession.sessionFile ?? null },
            this.ports.settings.getSettingsSnapshot().externalReadDirectories,
            { resetSelection: true },
          );
          await tab.controllers.openSessionController?.switchTo(openSession.id);
        }
      } else if (!tab.openSessionId && tab.state.messages.length === 0) {
        // New tab with no openSession - initialize welcome greeting
        tab.controllers.openSessionController?.initializeWelcome();
      }

      this.callbacks.onTabSwitched?.(previousTabId, tabId);
      resolveSwitch();
    } catch (error) {
      rejectSwitch(error);
      throw error;
    } finally {
      this.isSwitchingTab = false;
      this.switchingPromise = null;
    }
  }

  /**
   * Closes a tab.
   * @param tabId The tab to close.
   * @param force If true, close even if streaming.
   * @returns True if the tab was closed.
   */
  async closeTab(tabId: TabId, force = false): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return false;
    }

    // Don't close if streaming unless forced
    if (tab.state.isStreaming && !force) {
      return false;
    }

    // If this is the last tab and it's already empty (no openSession),
    // don't close it - it's already a blank draft container.
    if (this.tabs.size === 1 && !tab.openSessionId && tab.state.messages.length === 0) {
      return false;
    }

    const wasActive = this.activeTabId === tabId;

    // Save openSession before closing.
    await tab.controllers.openSessionController?.save();

    if (wasActive) {
      const fallback = await this.ensureFallbackTabForActiveRemoval(tabId);
      if (!fallback) {
        return false;
      }

      await this.switchToTab(fallback.id);
      if (this.activeTabId === tabId) {
        return false;
      }
    }

    // Destroy only after another tab is visible so the view never flashes blank.
    await destroyTab(tab);
    this.tabs.delete(tabId);
    this.callbacks.onTabClosed?.(tabId);

    return true;
  }

  async archiveTab(tabId: TabId): Promise<void> {
    if (this.isSwitchingTab) {
      await this.switchingPromise;
    }

    const tab = this.tabs.get(tabId);
    if (!tab || tab.isArchived) {
      return;
    }

    if (this.activeTabId !== tabId) {
      tab.isArchived = true;
      this.callbacks.onTabArchived?.(tabId, true);
      return;
    }

    const fallback = await this.ensureFallbackTabForActiveRemoval(tabId);
    if (!fallback) {
      return;
    }

    tab.isArchived = true;
    this.callbacks.onTabArchived?.(tabId, true);
    await this.switchToTab(fallback.id);

    if (this.activeTabId === tabId) {
      tab.isArchived = false;
      this.callbacks.onTabArchived?.(tabId, false);
      activateTab(tab);
    }
  }

  async reorderTabs(
    openTabIds: readonly TabId[],
    archivedTabIds: readonly TabId[],
  ): Promise<boolean> {
    const requestedIds = [...openTabIds, ...archivedTabIds];
    if (
      requestedIds.length !== this.tabs.size
      || new Set(requestedIds).size !== requestedIds.length
      || requestedIds.some(tabId => !this.tabs.has(tabId))
    ) return false;

    let resolvedOpenIds = [...openTabIds];
    if (resolvedOpenIds.length === 0) {
      const fallback = await this.createTab(undefined, undefined, { activate: false });
      if (!fallback) return false;
      resolvedOpenIds = [fallback.id];
    }

    if (this.activeTabId && archivedTabIds.includes(this.activeTabId)) {
      await this.switchToTab(resolvedOpenIds[0]!);
      if (this.activeTabId !== resolvedOpenIds[0]) return false;
    }

    const resolvedIds = [...resolvedOpenIds, ...archivedTabIds];
    if (!this.tabs.reorder(resolvedIds)) return false;
    const archivedSet = new Set(archivedTabIds);
    for (const tabId of resolvedIds) {
      const tab = this.tabs.get(tabId)!;
      tab.isArchived = archivedSet.has(tabId);
    }
    this.callbacks.onTabsReordered?.();
    return true;
  }

  async renameTabTitle(tabId: TabId, title: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const trimmed = title.trim();
    if (!trimmed) return;

    // Blank tabs: store draft title only; do not create an empty session.
    if (!tab.openSessionId) {
      tab.draftTitle = trimmed;
      this.callbacks.onTabTitleChanged?.(tab.id, trimmed);
      return;
    }

    tab.draftTitle = null;
    await this.ports.sessions.renameSession(tab.openSessionId, trimmed, 'custom');
    this.callbacks.onTabTitleChanged?.(tab.id, trimmed);
  }

  private getFallbackTabForRemoval(tabId: TabId): TabData | null {
    const orderedTabs = Array.from(this.tabs.values());
    const activeIndex = orderedTabs.findIndex(candidate => candidate.id === tabId);
    const openTabs = orderedTabs.filter(candidate => !candidate.isArchived);
    const openIndex = openTabs.findIndex(candidate => candidate.id === tabId);

    if (openIndex >= 0) {
      return openTabs[openIndex - 1] ?? openTabs[openIndex + 1] ?? null;
    }

    return orderedTabs[activeIndex - 1] ?? orderedTabs[activeIndex + 1] ?? null;
  }

  private async ensureFallbackTabForActiveRemoval(tabId: TabId): Promise<TabData | null> {
    return this.getFallbackTabForRemoval(tabId)
      ?? this.createTab(undefined, undefined, { activate: false });
  }
  private unarchiveTabForActivation(tab: TabData): void {
    if (!tab.isArchived) {
      return;
    }

    tab.isArchived = false;
    this.callbacks.onTabArchived?.(tab.id, false);
  }

  // ============================================
  // Tab Queries
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) ?? null : null;
  }

  /** Gets the active tab ID. */
  getActiveTabId(): TabId | null {
    return this.activeTabId;
  }

  /** Gets a tab by ID. */
  getTab(tabId: TabId): TabData | null {
    return this.tabs.get(tabId) ?? null;
  }

  /** Gets all tabs. */
  getAllTabs(): TabData[] {
    return Array.from(this.tabs.values());
  }

  /** Refresh settings-backed roots without resetting per-session selections. */
  syncPinnedExternalContextPaths(paths: string[]): void {
    for (const tab of this.tabs.values()) {
      tab.ui.externalContextSelector?.setPinnedPaths(paths);
    }
  }

  /** Gets the number of tabs. */
  getTabCount(): number {
    return this.tabs.size;
  }

  /** Checks if more tabs can be created. */
  canCreateTab(): boolean {
    return true;
  }

  // ============================================
  // Tab Bar Data
  // ============================================

  /** Gets data for rendering the tab bar. */
  getTabBarItems(): TabBarItem[] {
    return buildTabBarItems(
      this.tabs.values(),
      this.activeTabId,
      this.tabs.size,
      this.ports.sessions,
    );
  }

  // ============================================
  // Session management
  // ============================================

  /**
   * Opens an open session in a new tab or existing tab.
   * @param openSessionId The session to open.
   * @param options Controls tab creation behavior.
   */
  async openSession(
    openSessionId: string,
    options: OpenSessionOptions = {},
  ): Promise<void> {
    await openSessionInTabManager(
      {
        tabs: this.tabs.values(),
        activateOpenSessionElsewhere: this.activateOpenSessionElsewhere,
        switchToTab: (tabId) => this.switchToTab(tabId),
        canCreateTab: () => this.canCreateTab(),
        createTab: (id, tabId, opts) => this.createTab(id, tabId, opts),
        getActiveTab: () => this.getActiveTab(),
      },
      openSessionId,
      options,
    );
  }

  /**
   * Creates a new session in the active tab.
   */
  async createNewSession(): Promise<void> {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      await activeTab.controllers.openSessionController?.createNew();
      // Sync tab.openSessionId with the newly created openSession
      activeTab.openSessionId = activeTab.state.currentOpenSessionId;
    }
  }

  invalidateSlashCommandCaches(): void {
    for (const tab of this.tabs.values()) {
      tab.ui?.slashCommandDropdown?.resetRuntimeSkillsCache();
    }
  }

  prefetchSlashCommandCaches(): void {
    for (const tab of this.tabs.values()) {
      void tab.ui?.slashCommandDropdown?.prefetchCaches();
    }
  }

  // ============================================
  // Fork
  // ============================================

  private async handleForkRequest(context: ForkContext): Promise<void> {
    await handleForkRequest(
      {
        sessions: this.ports.sessions,
        getActiveTab: () => this.getActiveTab(),
        createTab: (openSessionId) => this.createTab(openSessionId),
      },
      context,
    );
  }

  async forkToNewTab(context: ForkContext): Promise<TabData | null> {
    return forkToNewTabHelper(
      {
        sessions: this.ports.sessions,
        getActiveTab: () => this.getActiveTab(),
        createTab: (openSessionId) => this.createTab(openSessionId),
      },
      context,
    );
  }

  // ============================================
  // Persistence
  // ============================================

  /** Gets the state to persist. */
  getPersistedState(): PersistedTabManagerState {
    return buildPersistedState(this.tabs.values(), this.activeTabId);
  }

  /** Restores state from persisted data. */
  async restoreState(state: PersistedTabManagerState): Promise<void> {
    await restorePersistedState(
      {
        createTab: (openSessionId, tabId, options) => this.createTab(openSessionId, tabId, options),
        switchToTab: (tabId) => this.switchToTab(tabId),
        hasTab: (tabId) => this.tabs.has(tabId),
        getTab: (tabId) => this.tabs.get(tabId) ?? null,
        getFirstTabId: () => Array.from(this.tabs.keys())[0] ?? null,
        getTabCount: () => this.tabs.size,
        setRestoringState: (value) => {
          this.isRestoringState = value;
        },
        createDefaultTab: () => this.createTab(),
      },
      state,
    );
  }

  // ============================================
  // Broadcast
  // ============================================

  /**
   * Broadcasts a function call to all initialized tab runtimes.
   * Used by settings managers to apply configuration changes to all tabs.
   * @param fn Function to call on each runtime.
   */
  async broadcastToAllTabs(fn: (service: PiChatService) => Promise<void>): Promise<void> {
    await broadcastToTabs(this.tabs.values(), fn);
  }

  // ============================================
  // Cleanup
  // ============================================

  /** Destroys all tabs and cleans up resources. */
  async destroy(): Promise<void> {
    // Save all sessions in parallel (independent per-tab)
    await Promise.all(
      Array.from(this.tabs.values()).map(
        tab => tab.controllers.openSessionController?.save() ?? Promise.resolve()
      )
    );

    // Destroy all tabs in parallel (independent per-tab, must run after saves complete)
    await Promise.all(Array.from(this.tabs.values()).map(tab => destroyTab(tab)));

    this.tabs.clear();
    this.activeTabId = null;
  }
}
