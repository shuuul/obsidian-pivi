import type { ChatPorts } from '@pivi/obsidian-ui/ports';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime';
import { Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

import { PluginLogger } from '../../shared/utils/logger';

const logger = new PluginLogger('TabManager');

import { revealWorkspaceLeaf } from '../../shared/utils/obsidianCompat';
import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  type ForkContext,
  getTabTitle,
  initializeTabControllers,
  initializeTabUI,
  wireTabInputEvents,
} from './Tab';
import { TabRuntimeRegistry } from './TabRuntimeRegistry';
import {
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabManagerCallbacks,
  type TabManagerInterface,
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
export class TabManager implements TabManagerInterface {
  private plugin: PiviChatHost;
  private containerEl: HTMLElement;
  private view: TabManagerViewHost;
  private ports: ChatPorts;

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
  ) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.view = view;
    this.callbacks = callbacks;
    this.ports = ports;
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
      ? await this.plugin.getOpenSessionById(openSessionId)
      : undefined;

    if (!openSession && sessionFile) {
      openSession = await this.plugin.openSessionByFile(sessionFile);
    }

    const tab = createTab({
      plugin: this.plugin,
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
        const conv = openSessionId ? this.plugin.getOpenSessionSync(openSessionId) : null;
        tab.sessionFile = conv?.sessionFile ?? tab.sessionFile;
        tab.leafId = null;
        // Safety net: apply blank-tab custom title when a session binds outside title coordinator.
        if (openSessionId && tab.draftTitle?.trim()) {
          const title = tab.draftTitle.trim();
          tab.draftTitle = null;
          void this.plugin.renameSession(openSessionId, title, 'custom').then(() => {
            this.callbacks.onTabTitleChanged?.(tab.id, title);
          });
        }
        this.callbacks.onTabSessionChanged?.(tab.id, openSessionId);
      },
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
    wireTabInputEvents(tab, this.plugin);

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
        const openSession = await this.plugin.openSessionByFile(tab.sessionFile);
        if (openSession) {
          tab.openSessionId = openSession.id;
          const externalContextPaths = getDefaultExternalContextPaths(this.plugin.settings);
          tab.ui.externalContextSelector?.resetForSession(externalContextPaths);

          tab.service?.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
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
    await this.plugin.renameSession(tab.openSessionId, trimmed, 'custom');
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

  /** Narrow chat feature ports for this manager's tabs. */
  getChatPorts(): ChatPorts {
    return this.ports;
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
    const openItems: TabBarItem[] = [];
    const archivedItems: TabBarItem[] = [];
    let index = 1;

    for (const tab of this.tabs.values()) {
      const item = {
        id: tab.id,
        index: index++,
        title: getTabTitle(tab, this.plugin),
        isActive: tab.id === this.activeTabId,
        isStreaming: tab.state.isStreaming,
        needsAttention: tab.state.needsAttention,
        isArchived: tab.isArchived,
        canClose: this.tabs.size > 1 || !tab.state.isStreaming,
      };
      if (tab.isArchived) {
        archivedItems.push(item);
      } else {
        openItems.push(item);
      }
    }

    return [...openItems, ...archivedItems];
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
    const preferNewTab = options.preferNewTab ?? false;
    const activate = options.activate ?? true;
    // Check if openSession is already open in this view's tabs
    for (const tab of this.tabs.values()) {
      if (tab.openSessionId === openSessionId) {
        await this.switchToTab(tab.id);
        const needsHydrate = tab.state.messages.length === 0;
        if (needsHydrate) {
          await tab.controllers.openSessionController?.switchTo(
            openSessionId,
          );
        }
        return;
      }
    }

    // Check if openSession is open in another view (split workspace scenario)
    // Compare view references directly (more robust than leaf comparison)
    const crossViewResult = this.plugin.findSessionAcrossViews(openSessionId);
    // Compare leaves — host contracts use PiviChatView, not the concrete TabManagerViewHost type.
    const isSameView = crossViewResult?.view.leaf === this.view.leaf;
    if (crossViewResult && !isSameView) {
      // Focus the other view and switch to its tab instead of opening duplicate
      await revealWorkspaceLeaf(this.plugin.app.workspace, crossViewResult.view.leaf);
      await crossViewResult.view.getTabManager()?.switchToTab(crossViewResult.tabId);
      return;
    }

    // Open in current tab or new tab
    if (preferNewTab && this.canCreateTab()) {
      await this.createTab(openSessionId, undefined, { activate });
    } else {
      // Open in current tab
      // Note: Don't set tab.openSessionId here - the onOpenSessionIdChanged callback
      // will sync it after successful switch. Setting it before switchTo() would cause
      // incorrect tab metadata if switchTo() returns early (streaming/switching/creating).
      const activeTab = this.getActiveTab();
      if (activeTab) {
        await activeTab.controllers.openSessionController?.switchTo(openSessionId);
      }
    }
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

  primeAgentRuntime(): void {
    this.prefetchSlashCommandCaches();
  }

  // ============================================
  // Fork
  // ============================================

  private async handleForkRequest(context: ForkContext): Promise<void> {
    const tab = await this.forkToNewTab(context);
    if (!tab) {
      new Notice(t('chat.fork.failed', { error: t('chat.errors.unableCreateForkTab') }));
      return;
    }
    new Notice(t('chat.fork.notice'));
  }

  async forkToNewTab(context: ForkContext): Promise<TabData | null> {
    const openSessionId = await this.createForkSession(context);
    try {
      const tab = await this.createTab(openSessionId);
      this.restoreForkPreviewIfEmpty(tab, context);
      return tab;
    } catch (error) {
      await this.plugin.deleteSession(openSessionId).catch((err) => {
        logger.warn(`Failed to delete session ${openSessionId} after tab creation failure`, err);
      });
      throw error;
    }
  }

  private async createForkSession(context: ForkContext): Promise<string> {
    const sourceOpenSession = this.getActiveTab()?.openSessionId
      ? this.plugin.getOpenSessionSync(this.getActiveTab()!.openSessionId!)
      : null;

    const title = context.sourceTitle
      ? this.buildForkTitle(context.sourceTitle, context.forkAtUserMessage)
      : undefined;

    if (!sourceOpenSession?.sessionFile) {
      throw new Error('Cannot fork: active tab has no JSONL session');
    }

    const forked = await this.plugin.forkSessionAt(
      sourceOpenSession,
      context.forkAtEntryId,
    );
    if (!forked) {
      throw new Error('Session fork failed');
    }

    const openSession = await this.plugin.createOpenSession({
      sessionFile: forked.sessionFile,
      sessionId: forked.sessionId,
    });
    await this.plugin.updateSession(openSession.id, {
      ...(title && { title }),
      ...(context.currentNote && { currentNote: context.currentNote }),
      messages: context.messages,
    });
    return openSession.id;
  }

  private restoreForkPreviewIfEmpty(tab: TabData | null, context: ForkContext): void {
    if (!tab || tab.state.messages.length > 0 || context.messages.length === 0) {
      return;
    }
    tab.state.messages = context.messages;
  }

  private buildForkTitle(sourceTitle: string, forkAtUserMessage?: number): string {
    const MAX_TITLE_LENGTH = 50;
    const forkSuffix = forkAtUserMessage ? ` (#${forkAtUserMessage})` : '';
    const forkPrefix = 'Fork: ';
    const maxSourceLength = MAX_TITLE_LENGTH - forkPrefix.length - forkSuffix.length;
    const truncatedSource = sourceTitle.length > maxSourceLength
      ? sourceTitle.slice(0, maxSourceLength - 1) + '…'
      : sourceTitle;
    let title = forkPrefix + truncatedSource + forkSuffix;

    const existingTitles = new Set(this.plugin.getSessionList().map(c => c.title));
    if (existingTitles.has(title)) {
      let n = 2;
      while (existingTitles.has(`${title} ${n}`)) n++;
      title = `${title} ${n}`;
    }

    return title;
  }

  // ============================================
  // Persistence
  // ============================================

  /** Gets the state to persist. */
  getPersistedState(): PersistedTabManagerState {
    const openTabs: PersistedTabState[] = [];

    for (const tab of this.tabs.values()) {
      openTabs.push({
        ...(tab.lifecycleState === 'blank' && tab.draftModel
          ? { draftModel: tab.draftModel }
          : {}),
        ...(tab.lifecycleState === 'blank' && tab.draftTitle
          ? { draftTitle: tab.draftTitle }
          : {}),
        tabId: tab.id,
        ...(tab.sessionFile ? { sessionFile: tab.sessionFile } : {}),
        ...(tab.isArchived ? { isArchived: true } : {}),
        ...(tab.state.needsAttention ? { needsAttention: true } : {}),
      });
    }

    return {
      openTabs,
      activeTabId: this.activeTabId,
    };
  }

  /** Restores state from persisted data. */
  async restoreState(state: PersistedTabManagerState): Promise<void> {
    this.isRestoringState = true;
    try {
      // Create tabs from persisted state with error handling.
      for (const tabState of state.openTabs) {
        try {
          await this.createTab(undefined, tabState.tabId, {
            activate: false,
            ...(typeof tabState.draftModel === 'string' ? { draftModel: tabState.draftModel } : {}),
            ...(typeof tabState.draftTitle === 'string' ? { draftTitle: tabState.draftTitle } : {}),
            ...(typeof tabState.sessionFile === 'string' ? { sessionFile: tabState.sessionFile } : {}),
            ...(tabState.isArchived ? { isArchived: true } : {}),
            ...(tabState.needsAttention ? { needsAttention: true } : {}),
          });
        } catch {
          // Continue restoring other tabs
        }
      }
    } finally {
      this.isRestoringState = false;
    }

    const fallbackTabId = state.openTabs.find((tabState) => this.tabs.has(tabState.tabId) && !tabState.isArchived)?.tabId
      ?? state.openTabs.find((tabState) => this.tabs.has(tabState.tabId))?.tabId
      ?? Array.from(this.tabs.keys())[0]
      ?? null;
    const activeTab = state.activeTabId ? this.tabs.get(state.activeTabId) : null;
    const targetTabId = activeTab && !activeTab.isArchived
      ? state.activeTabId
      : fallbackTabId;

    // Switch to the previously active tab after all tabs are restored so background
    // restore does not warm the first restored tab by accident.
    if (targetTabId) {
      try {
        await this.switchToTab(targetTabId);
      } catch {
        // Ignore switch errors
      }
    }

    // If no tabs were restored, create a default one
    if (this.tabs.size === 0) {
      await this.createTab();
    }
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
    await this.broadcastToTabs(this.tabs.values(), fn);
  }

  private async broadcastToTabs(
    tabs: Iterable<TabData>,
    fn: (service: PiChatService) => Promise<void>,
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const tab of tabs) {
      if (tab.service && tab.serviceInitialized) {
        promises.push(
          fn(tab.service).catch(() => {
            // Silently ignore broadcast errors
          })
        );
      }
    }

    await Promise.all(promises);
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
