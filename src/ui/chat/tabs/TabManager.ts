import type { PiChatService } from '@pivi/pi-runtime';
import { Notice } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';

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
import {
  DEFAULT_MAX_TABS,
  MAX_TABS,
  MIN_TABS,
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabManagerCallbacks,
  type TabManagerInterface,
  type TabManagerViewHost,
} from './types';

function isTabManagerViewHost(value: unknown): value is TabManagerViewHost {
  return !!value
    && typeof value === 'object'
    && 'getTabManager' in (value as Record<string, unknown>);
}

type CreateTabOptions = {
  activate?: boolean;
  draftModel?: string;
  sessionFile?: string | null;
};

type OpenSessionOptions = {
  preferNewTab?: boolean;
  activate?: boolean;
};

/**
 * TabManager coordinates multiple chat tabs.
 */
export class TabManager implements TabManagerInterface {
  private plugin: PiviPlugin;
  private containerEl: HTMLElement;
  private view: TabManagerViewHost;

  private tabs: Map<TabId, TabData> = new Map();
  private activeTabId: TabId | null = null;
  private callbacks: TabManagerCallbacks;
  private isRestoringState = false;

  /** Guard to prevent concurrent tab switches. */
  private isSwitchingTab = false;

  /**
   * Gets the current max tabs limit from settings.
   * Clamps to MIN_TABS and MAX_TABS bounds.
   */
  private getMaxTabs(): number {
    const settingsValue = this.plugin.settings.maxTabs ?? DEFAULT_MAX_TABS;
    return Math.max(MIN_TABS, Math.min(MAX_TABS, settingsValue));
  }

  constructor(
    plugin: PiviPlugin,
    containerEl: HTMLElement,
    view: TabManagerViewHost,
    callbacks?: TabManagerCallbacks,
  );
  constructor(
    plugin: PiviPlugin,
    legacyArg: unknown,
    containerEl: HTMLElement,
    view: TabManagerViewHost,
    callbacks?: TabManagerCallbacks,
  );
  constructor(
    plugin: PiviPlugin,
    arg2: unknown,
    arg3: HTMLElement | TabManagerViewHost,
    arg4?: TabManagerViewHost | TabManagerCallbacks,
    arg5: TabManagerCallbacks = {},
  ) {
    this.plugin = plugin;

    if (isTabManagerViewHost(arg3)) {
      this.containerEl = arg2 as HTMLElement;
      this.view = arg3;
      this.callbacks = (arg4 as TabManagerCallbacks | undefined) ?? {};
      return;
    }

    this.containerEl = arg3;
    this.view = arg4 as TabManagerViewHost;
    this.callbacks = arg5;
  }

  // ============================================
  // Tab Lifecycle
  // ============================================

  /**
   * Creates a new tab.
   * @param openSessionId Optional session to load into the tab.
   * @param tabId Optional tab ID (for restoration).
   * @param options Controls whether the new tab becomes active immediately.
   * @returns The created tab, or null if max tabs reached.
   */
  async createTab(
    openSessionId?: string | null,
    tabId?: TabId,
    options: CreateTabOptions = {},
  ): Promise<TabData | null> {
    const maxTabs = this.getMaxTabs();
    if (this.tabs.size >= maxTabs) {
      return null;
    }

    const { activate = true, draftModel, sessionFile } = options;

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
      onStreamingChanged: (isStreaming) => {
        if (!isStreaming && tab.id !== this.activeTabId) {
          tab.state.needsAttention = true;
        }
        this.callbacks.onTabStreamingChanged?.(tab.id, isStreaming);
      },
      onTitleChanged: (title) => {
        this.callbacks.onTabTitleChanged?.(tab.id, title);
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
        this.callbacks.onTabSessionChanged?.(tab.id, openSessionId);
      },
    });

    const getSlashCatalogConfig = () => {
      const catalog = this.plugin.getPiWorkspace()?.slashCommandCatalog;
      if (!catalog) return null;
      return {
        config: catalog.getDropdownConfig(),
        getEntries: () => catalog.listDropdownEntries({ includeBuiltIns: true }),
      };
    };

    // Initialize UI components with provider catalog
    initializeTabUI(tab, this.plugin, { getSlashCatalogConfig });

    initializeTabControllers(
      tab,
      this.plugin,
      this.view,
      (forkContext) => this.handleForkRequest(forkContext),
      (openSessionId) => this.openSession(openSessionId),
      getSlashCatalogConfig,
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

  /**
   * Switches to a different tab.
   * @param tabId The tab to switch to.
   */
  async switchToTab(tabId: TabId): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    // Guard against concurrent tab switches
    if (this.isSwitchingTab) {
      return;
    }

    this.isSwitchingTab = true;
    const previousTabId = this.activeTabId;

    try {
      // Deactivate current tab
      if (previousTabId && previousTabId !== tabId) {
        const currentTab = this.tabs.get(previousTabId);
        if (currentTab) {
          deactivateTab(currentTab);
        }
      }

      // Activate new tab
      this.activeTabId = tabId;
      tab.state.needsAttention = false;
      activateTab(tab);

      // Load openSession if not already loaded
      if (tab.openSessionId && tab.state.messages.length === 0) {
        await tab.controllers.openSessionController?.switchTo(
          tab.openSessionId,
        );
      } else if (
        tab.openSessionId
        && tab.state.messages.length > 0
        && tab.service
        && !tab.state.isStreaming
        && !tab.state.hasPendingSessionSave
      ) {
        // Passive sync is only safe once local tab state has been persisted.
        const openSession = this.plugin.getOpenSessionSync(tab.openSessionId);
        if (openSession) {
          const hasMessages = openSession.messages.length > 0;
          const externalContextPaths = hasMessages
            ? openSession.externalContextPaths || []
            : (this.plugin.settings.persistentExternalContextPaths || []);

          tab.service.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
        }
      } else if (!tab.openSessionId && tab.state.messages.length === 0) {
        // New tab with no openSession - initialize welcome greeting
        tab.controllers.openSessionController?.initializeWelcome();
      }

      this.callbacks.onTabSwitched?.(previousTabId, tabId);
    } finally {
      this.isSwitchingTab = false;
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

    // Save openSession before closing
    await tab.controllers.openSessionController?.save();

    // Capture tab order BEFORE deletion for fallback calculation
    const tabIdsBefore = Array.from(this.tabs.keys());
    const closingIndex = tabIdsBefore.indexOf(tabId);

    // Destroy tab resources (async for proper cleanup)
    await destroyTab(tab);
    this.tabs.delete(tabId);
    this.callbacks.onTabClosed?.(tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = null;

      if (this.tabs.size > 0) {
        // Fallback strategy: prefer previous tab, except for first tab (go to next)
        const fallbackTabId = closingIndex === 0
          ? tabIdsBefore[1]  // First tab: go to next
          : tabIdsBefore[closingIndex - 1];  // Others: go to previous

        if (fallbackTabId && this.tabs.has(fallbackTabId)) {
          await this.switchToTab(fallbackTabId);
        }
      } else {
        // Create a replacement blank tab.
        await this.createTab();
      }
    }

    return true;
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

  /** Gets the number of tabs. */
  getTabCount(): number {
    return this.tabs.size;
  }

  /** Checks if more tabs can be created. */
  canCreateTab(): boolean {
    return this.tabs.size < this.getMaxTabs();
  }

  // ============================================
  // Tab Bar Data
  // ============================================

  /** Gets data for rendering the tab bar. */
  getTabBarItems(): TabBarItem[] {
    const items: TabBarItem[] = [];
    let index = 1;

    for (const tab of this.tabs.values()) {
      items.push({
        id: tab.id,
        index: index++,
        title: getTabTitle(tab, this.plugin),
        isActive: tab.id === this.activeTabId,
        isStreaming: tab.state.isStreaming,
        needsAttention: tab.state.needsAttention,
        canClose: this.tabs.size > 1 || !tab.state.isStreaming,
      });
    }

    return items;
  }

  // ============================================
  // Session management
  // ============================================

  /**
   * Opens a openSession in a new tab or existing tab.
   * @param openSessionId The session to open.
   * @param options Controls tab creation behavior (backward-compatible with boolean).
   */
  async openSession(
    openSessionId: string,
    options: boolean | OpenSessionOptions = false,
  ): Promise<void> {
    const preferNewTab = typeof options === 'boolean'
      ? options
      : options.preferNewTab ?? false;
    const activate = typeof options === 'boolean'
      ? true
      : options.activate ?? true;
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
    const isSameView = crossViewResult?.view === this.view;
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

  primeAgentRuntime(): void {
    // Pi resolves slash commands from ready runtimes; no separate warmup path.
  }

  // ============================================
  // Fork
  // ============================================

  private async handleForkRequest(context: ForkContext): Promise<void> {
    const tab = await this.forkToNewTab(context);
    if (!tab) {
      const maxTabs = this.getMaxTabs();
      new Notice(t('chat.fork.maxTabsReached', { count: String(maxTabs) }));
      return;
    }
    new Notice(t('chat.fork.notice'));
  }

  async forkToNewTab(context: ForkContext): Promise<TabData | null> {
    const maxTabs = this.getMaxTabs();
    if (this.tabs.size >= maxTabs) {
      return null;
    }

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
    tab.renderer?.renderMessages(context.messages, () => '');
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
        tabId: tab.id,
        ...(tab.sessionFile ? { sessionFile: tab.sessionFile } : {}),
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
            ...(typeof tabState.sessionFile === 'string' ? { sessionFile: tabState.sessionFile } : {}),
          });
        } catch {
          // Continue restoring other tabs
        }
      }
    } finally {
      this.isRestoringState = false;
    }

    const fallbackTabId = state.openTabs.find((tabState) => this.tabs.has(tabState.tabId))?.tabId
      ?? Array.from(this.tabs.keys())[0]
      ?? null;
    const targetTabId = state.activeTabId && this.tabs.has(state.activeTabId)
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
