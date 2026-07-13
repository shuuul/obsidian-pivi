import {
  type ImperativeChatAdapter,
  mountChatView,
  type MountedSurface,
} from '@pivi/obsidian-ui/mount';
import { VIEW_TYPE_PIVI } from '@pivi/pivi-agent-core/foundation';
import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Scope } from 'obsidian';

import type { PiviChatHost, PiviSettingsHost } from '@/app/hostContracts';
import { appI18n } from '@/app/i18n';
import { createChatUiPorts } from '@/app/ui/createUiPorts';
import {
  type CreatedImperativeChatAdapter,
  createImperativeChatAdapter,
} from '@/app/ui/imperativeChatAdapter';
import type { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabData } from '@/ui/chat/tabs/types';
import { getActiveWindow } from '@/ui/shared/dom';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

/** View host needs chat APIs plus composition storage/workspace for ports + tab persistence. */
type PiviViewPlugin = PiviChatHost & Pick<PiviSettingsHost, 'getPiWorkspace' | 'storage'>;

export class PiviViewHost extends ItemView {
  private plugin: PiviViewPlugin;
  private mountedSurface: MountedSurface | null = null;
  private chatAdapter: CreatedImperativeChatAdapter | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PiviViewPlugin) {
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
    this.chatAdapter?.refreshModelSelector();
  }

  invalidateSlashCommandCaches(): void {
    this.chatAdapter?.invalidateSlashCommandCaches();
  }

  prefetchSlashCommandCaches(): void {
    this.chatAdapter?.prefetchSlashCommandCaches();
  }

  /** Updates hidden slash commands on all tabs after settings changes. */
  updateHiddenSlashCommands(): void {
    this.chatAdapter?.updateHiddenSlashCommands();
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

    const chatAdapter = createImperativeChatAdapter({
      plugin: this.plugin,
      view: this,
      getContainerEl: () => this.containerEl,
      persistTabState: () => this.persistTabState(),
      restoreOrCreateTabs: tabManager => this.restoreOrCreateTabs(tabManager),
    });
    this.chatAdapter = chatAdapter;

    const shell = chatAdapter.prepareShell(ownerDocument);
    const ports = createChatUiPorts(this.plugin);
    const imperativeAdapter: ImperativeChatAdapter = {
      mount: async (adapterContainer, environment, adapterPorts) => {
        await chatAdapter.mount(adapterContainer, environment, adapterPorts);
        this.wireEventHandlers();
      },
      dispose: () => this.disposeChatRuntimeSurface(),
    };

    this.mountedSurface = await mountChatView({
      container,
      ownerDocument,
      ownerWindow,
      portalContainer: ownerDocument.body,
      i18n: appI18n,
      ports,
      chatShell: {
        store: shell.store,
        actions: chatAdapter.getShellActions(),
        inputPortalContainer: shell.inputPortalContainer,
        activeChat: shell.activeChat,
        surfaceActions: chatAdapter.getSurfaceActions(),
        welcomeQuoteAdapter: chatAdapter.getWelcomeQuoteAdapter(),
      },
      imperativeAdapter,
    });
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
    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    await this.persistTabStateImmediate();

    await this.chatAdapter?.dispose();
    this.chatAdapter = null;

    this.scope = null;
  }

  /**
   * Updates layout when tabBarPosition setting changes.
   * Called from settings when user changes the tab bar position.
   */
  updateLayoutForPosition(): void {
    this.chatAdapter?.updateLayoutForPosition();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.chatAdapter?.refreshTabControls();
  }

  async createNewTab(): Promise<void> {
    await this.chatAdapter?.createNewTab();
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
        const activeTab = this.chatAdapter?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.chatAdapter?.getActiveTab()?.ui.fileContextManager;
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
          this.chatAdapter?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.chatAdapter?.getActiveTab();
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

  private async restoreOrCreateTabs(tabManager: TabManager): Promise<void> {
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await tabManager.restoreState(persistedState);
      return;
    }

    await tabManager.createTab();
  }

  private persistTabState(): void {
    // Debounce persistence to avoid rapid writes (300ms delay)
    const win = getActiveWindow(this.containerEl);
    if (this.pendingPersist !== null) {
      win.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = win.setTimeout(() => {
      this.pendingPersist = null;
      const tabManager = this.chatAdapter?.getTabManager();
      if (!tabManager) return;
      const state = tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    if (this.pendingPersist !== null) {
      getActiveWindow(this.containerEl).clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    const tabManager = this.chatAdapter?.getTabManager();
    if (!tabManager) return;
    const state = tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.chatAdapter?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.chatAdapter?.getTabManager() ?? null;
  }
}
