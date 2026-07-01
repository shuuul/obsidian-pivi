import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';

import type PiviPlugin from '../../main';
import { getHiddenSlashCommandSet } from '../../pi/agent/commands/hiddenCommands';
import { PiSettingsCoordinator } from '../../pi/PiSettingsCoordinator';
import { VIEW_TYPE_PIVI } from '../../pi/types';
import { createChatIconSvg } from '../../pi/ui/icons';
import { piChatUIConfig } from '../../pi/ui/PiChatUIConfig';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import { getActiveWindow } from '../shared/dom';
import type { HistorySessionOpenState } from './controllers/SessionController';
import { refreshBlankTabModelState, updatePlanModeUI } from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import type { TabData, TabId } from './tabs/types';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class PiviView extends ItemView {
  private plugin: PiviPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private titleSlotEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private titleTextEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private headerActionsContent: HTMLElement | null = null;
  private newTabButtonEl: HTMLElement | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PiviPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches PiviView.prototype.load
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
      const providerSettings = PiSettingsCoordinator.getSettingsSnapshot(
        this.plugin.settings,
      );
      const model = providerSettings.model;
      const uiConfig = piChatUIConfig;
      const contextWindow = uiConfig.getContextWindowSize(
        model,
        providerSettings.customContextLimits,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
      }

      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.permissionToggle?.updateDisplay();
      tab.dom.inputWrapper.toggleClass(
        'pivi-input-plan-mode',
        providerSettings.permissionMode === 'plan',
      );
    }

    this.tabManager?.primeAgentRuntime();
  }

  invalidateSlashCommandCaches(): void {
    this.tabManager?.invalidateSlashCommandCaches();
  }

  /** Updates hidden slash commands on all tabs after settings changes. */
  updateHiddenSlashCommands(): void {
    const hidden = getHiddenSlashCommandSet(this.plugin.settings);
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(hidden);
    }
  }

  async onOpen() {
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

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('pivi-container');

    const header = this.viewContainerEl.createDiv({ cls: 'pivi-header' });
    this.buildHeader(header);

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'pivi-tab-content-container' });

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateNavRowLocation();
          this.persistTabState();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateNavRowLocation();
          this.persistTabState();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.updateNavRowLocation();
          this.persistTabState();
        },
        onTabStreamingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabSessionChanged: () => {
          this.updateTabBar();
          this.persistTabState();
        },
      }
    );

    this.wireEventHandlers();
    await this.restoreOrCreateTabs();
    this.syncHeaderLogo();
    this.updateLayoutForPosition();
    this.tabManager?.primeAgentRuntime();
  }

  async onClose() {
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

    this.tabBar?.destroy();
    this.tabBar = null;
    this.scope = null;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement) {
    this.headerEl = header;

    // Title slot container (logo + title or tabs)
    this.titleSlotEl = header.createDiv({ cls: 'pivi-title-slot' });

    // Logo (hidden when 2+ tabs) — populated by syncHeaderLogo()
    this.logoEl = this.titleSlotEl.createSpan({ cls: 'pivi-logo' });
    this.syncHeaderLogo();

    // Title text (hidden in header mode when 2+ tabs)
    this.titleTextEl = this.titleSlotEl.createEl('h4', { text: 'Pivi', cls: 'pivi-title-text' });

    // Header actions container (for header mode - initially hidden)
    this.headerActionsEl = header.createDiv({ cls: 'pivi-header-actions pivi-header-actions-slot pivi-hidden' });
  }

  /**
   * Builds the shared tab badge row and header actions.
   * This is called once and the content is moved between locations.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument = this.containerEl.ownerDocument;
    const addButtonActivation = (
      buttonEl: HTMLElement,
      onActivate: (event: MouseEvent | KeyboardEvent) => void,
    ): void => {
      buttonEl.addEventListener('click', onActivate);
      buttonEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate(event);
        }
      });
    };

    // Create a fragment to hold nav row content
    const fragment = activeDocument.createDocumentFragment();

    // Tab badges (left side in nav row, or in title slot for header mode)
    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'pivi-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Failed to create tab'));
      },
    });
    fragment.appendChild(this.tabBarContainerEl);

    // Action buttons (right side in the bottom chat overlay, or header mode)
    this.headerActionsContent = activeDocument.createElement('div');
    this.headerActionsContent.className = 'pivi-header-actions';

    // New tab button (plus icon)
    this.newTabButtonEl = this.headerActionsContent.createDiv({ cls: 'pivi-header-btn pivi-new-tab-btn' });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.setAttribute('aria-label', 'New tab');
    this.newTabButtonEl.setAttribute('role', 'button');
    this.newTabButtonEl.setAttribute('tabindex', '0');
    addButtonActivation(this.newTabButtonEl, () => {
      void this.createNewTab().catch(() => new Notice('Failed to create tab'));
    });

    // New session button (square-pen icon - new session in current tab)
    const newBtn = this.headerActionsContent.createDiv({ cls: 'pivi-header-btn' });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', 'New session');
    newBtn.setAttribute('role', 'button');
    newBtn.setAttribute('tabindex', '0');
    addButtonActivation(newBtn, () => {
      void (async () => {
        await this.tabManager?.createNewSession();
        this.updateHistoryDropdown();
      })().catch(() => new Notice('Failed to create session'));
    });

    // History dropdown
    const historyContainer = this.headerActionsContent.createDiv({ cls: 'pivi-history-container' });
    const historyBtn = historyContainer.createDiv({ cls: 'pivi-header-btn' });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', 'Chat history');
    historyBtn.setAttribute('role', 'button');
    historyBtn.setAttribute('tabindex', '0');

    this.historyDropdown = historyContainer.createDiv({ cls: 'pivi-history-menu' });

    addButtonActivation(historyBtn, (event) => {
      event.stopPropagation();
      this.toggleHistoryDropdown();
    });

    fragment.appendChild(this.headerActionsContent);

    // Create a wrapper div to hold bottom-overlay controls in input mode.
    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'pivi-input-nav-content';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  /**
   * Moves nav row content based on tabBarPosition setting.
   * - 'input' mode: Tab badges and actions float inside the bottom of chat.
   * - 'header' mode: Tab badges go to title slot (after logo).
   */
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl || !this.headerActionsContent) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    if (isHeaderMode) {
      // Header mode: Tab badges go to title slot and actions go to header right side.
      if (this.titleSlotEl) {
        this.titleSlotEl.appendChild(this.tabBarContainerEl);
      }
      if (this.headerActionsEl) {
        this.headerActionsEl.appendChild(this.headerActionsContent);
        this.headerActionsEl.removeClass('pivi-hidden');
      }
      this.navRowContent?.remove();
    } else {
      // Input mode: Controls live in a transparent overlay inside the chat panel.
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab && this.navRowContent) {
        this.navRowContent.appendChild(this.tabBarContainerEl);
        this.navRowContent.appendChild(this.headerActionsContent);
        activeTab.dom.messagesBottomControlsEl.appendChild(this.navRowContent);
      }
      if (this.headerActionsEl) {
        this.headerActionsEl.addClass('pivi-hidden');
      }
    }
  }

  /**
   * Updates layout when tabBarPosition setting changes.
   * Called from settings when user changes the tab bar position.
   */
  updateLayoutForPosition(): void {
    if (!this.viewContainerEl) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Update container class for CSS styling
    this.viewContainerEl.toggleClass('pivi-container--header-mode', isHeaderMode);

    // Move nav content to appropriate location
    this.updateNavRowLocation();

    // Update tab bar and title visibility
    this.updateTabBarVisibility();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice('Failed to switch tab'));
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
      new Notice('Failed to close tab');
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? 3;
      new Notice(`Maximum ${maxTabs} tabs allowed`);
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;
    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Hide tab badges when only 1 tab, show when 2+
    this.tabBarContainerEl.toggleClass('pivi-hidden', !showTabBar);

    // In header mode, badges replace logo/title in the same location
    // In input mode, keep logo/title visible (badges are in nav row)
    const hideBranding = showTabBar && isHeaderMode;
    if (this.logoEl) {
      this.logoEl.toggleClass('pivi-hidden', hideBranding);
    }
    if (this.titleTextEl) {
      this.titleTextEl.toggleClass('pivi-hidden', hideBranding);
    }

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    // Always keep the button visible; toggle a disabled style when at max tabs.
    this.newTabButtonEl.removeClass('pivi-hidden');
    this.newTabButtonEl.toggleClass('pivi-is-disabled', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
    } else {
      this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    }
  }

  /** Rebuilds the header logo SVG from the active chat UI config. */
  private syncHeaderLogo(): void {
    if (!this.logoEl) return;
    const icon = piChatUIConfig.getChatIcon?.();
    if (!icon) return;
    if (this.logoEl.querySelector('svg')) return;
    this.logoEl.empty();
    const svg = createChatIconSvg(icon, {
      className: 'pivi-brand-icon',
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const openSessionController = activeTab?.controllers.openSessionController;

    if (openSessionController) {
      openSessionController.renderHistoryDropdown(this.historyDropdown, {
        onSelectSession: (id, leafId) => this.openHistorySession(id, leafId),
        onOpenSessionInNewTab: (id, activate, leafId) =>
          this.openHistorySessionInNewTab(id, activate, leafId),
        getSessionOpenState: (id) => this.getHistorySessionOpenState(id),
      });
    }
  }

  private async openHistorySession(openSessionId: string, leafId?: string | null): Promise<void> {
    await this.tabManager?.openSession(openSessionId, { leafId });
    this.historyDropdown?.removeClass('visible');
  }

  private async openHistorySessionInNewTab(
    openSessionId: string,
    activate = true,
    leafId?: string | null,
  ): Promise<void> {
    await this.tabManager?.openSession(openSessionId, {
      preferNewTab: true,
      activate,
      leafId,
    });
    this.historyDropdown?.removeClass('visible');
  }

  private getHistorySessionOpenState(openSessionId: string): HistorySessionOpenState {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.openSessionId === openSessionId) {
      return 'current';
    }

    if (this.findTabWithSession(openSessionId)) {
      return 'open';
    }

    const crossViewResult = this.plugin.findSessionAcrossViews(openSessionId);
    if (crossViewResult && crossViewResult.view !== this) {
      return 'open';
    }

    return 'closed';
  }

  private findTabWithSession(openSessionId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.openSessionId === openSessionId) ?? null;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.historyDropdown?.removeClass('visible');
    });

    // View-level Shift+Tab to toggle plan mode (works from any focused element)
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const current = PiSettingsCoordinator.getSettingsSnapshot(
          this.plugin.settings,
        ).permissionMode as string;
        if (current === 'plan') {
          const restoreMode = activeTab.state.prePlanPermissionMode ?? 'normal';
          activeTab.state.prePlanPermissionMode = null;
          updatePlanModeUI(activeTab, this.plugin, restoreMode);
        } else {
          activeTab.state.prePlanPermissionMode = current;
          updatePlanModeUI(activeTab, this.plugin, 'plan');
        }
      }
    });

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
