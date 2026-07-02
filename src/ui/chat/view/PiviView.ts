import { VIEW_TYPE_PIVI } from '@pivi/core';
import { getHiddenSlashCommandSet } from '@pivi/core/settings';
// TODO(ui-package): move Pi chat UI config behind an @pivi package API.
import { piChatUIConfig } from '@pivi/pi-runtime/PiChatUIConfig';
// TODO(ui-package): move Pi settings coordination behind an @pivi package API.
import { PiSettingsCoordinator } from '@pivi/pi-runtime/PiSettingsCoordinator';
import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
// TODO(ui-package): move Pi chat icon helpers behind an @pivi package API.
import { createChatIconSvg } from '@/ui/shared/utils/icons';

import { getActiveWindow } from '../../shared/dom';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../shared/utils/animationFrame';
import { refreshBlankTabModelState, updatePlanModeUI } from '../tabs/Tab';
import { TabBar } from '../tabs/TabBar';
import { TabManager } from '../tabs/TabManager';
import type { TabData, TabId } from '../tabs/types';
// TODO(ui-package): migrate chat usage helpers into @/ui.
import { recalculateUsageForModel } from '../utils/usageInfo';

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

  }

  /**
   * Builds the shared tab switcher.
   * This is called once and the content is moved between locations.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument = this.containerEl.ownerDocument;

    // Tab switcher (left side in nav row, or in title slot for header mode)
    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'pivi-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onStartNewChat: () => {
        void this.startNewChat().catch(() => new Notice('Failed to create chat'));
      },
    });

    // Create a wrapper div to hold bottom-overlay controls in input mode.
    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'pivi-input-nav-content';
    wrapper.appendChild(this.tabBarContainerEl);
    return wrapper;
  }

  /**
   * Moves nav row content based on tabBarPosition setting.
   * - 'input' mode: Tab switcher floats inside the bottom of chat.
   * - 'header' mode: Tab switcher goes to title slot (after logo).
   */
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    if (isHeaderMode) {
      // Header mode: the tab switcher replaces the title slot.
      if (this.titleSlotEl) {
        this.titleSlotEl.appendChild(this.tabBarContainerEl);
      }
      this.navRowContent?.remove();
    } else {
      // Input mode: the switcher lives in a transparent overlay inside the chat panel.
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab && this.navRowContent) {
        this.navRowContent.appendChild(this.tabBarContainerEl);
        activeTab.dom.messagesBottomControlsEl.appendChild(this.navRowContent);
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

  private async startNewChat(): Promise<void> {
    await this.tabManager?.createNewSession();
    this.updateTabBarVisibility();
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
    const showTabBar = tabCount >= 1;
    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // The Notion-style switcher doubles as the active tab title, so keep it visible.
    this.tabBarContainerEl.toggleClass('pivi-hidden', !showTabBar);

    // In header mode, the switcher replaces logo/title in the same location.
    // In input mode, keep logo/title visible because the switcher is in the nav row.
    const hideBranding = showTabBar && isHeaderMode;
    if (this.logoEl) {
      this.logoEl.toggleClass('pivi-hidden', hideBranding);
    }
    if (this.titleTextEl) {
      this.titleTextEl.toggleClass('pivi-hidden', hideBranding);
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
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.tabBar?.closeMenu();
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
