import { VIEW_TYPE_PIVI } from '@pivi/pivi-agent-core/foundation';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import {
  type ImperativeChatAdapter,
  mountChatView,
  type MountedSurface,
} from '@pivi/pivi-react/mount';
import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Scope } from 'obsidian';

import type {
  PiviChatViewHandle,
  PiviPluginWorkspace,
} from '@/app/hostContracts';
import { appI18n } from '@/app/i18n';
import { activateOpenSessionElsewhere } from '@/app/ui/activateOpenSessionElsewhere';
import {
  type ChatUiCompositionHost,
  createChatUiPorts,
} from '@/app/ui/createUiPorts';
import {
  type CreatedImperativeChatAdapter,
  createImperativeChatAdapter,
} from '@/app/ui/imperativeChatAdapter';
import { obsidianPresentationPlatform } from '@/app/ui/obsidianPresentationPlatform';
import { getActiveWindow } from '@/ui/shared/dom';
import { revealWorkspaceLeaf } from '@/ui/shared/utils/obsidianCompat';

const logger = new PluginLogger('PiviViewHost');

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class PiviViewHost extends ItemView {
  private plugin: ChatUiCompositionHost;
  private readonly getWorkspace: () => Promise<PiviPluginWorkspace>;
  private mountedSurface: MountedSurface | null = null;
  private chatAdapter: CreatedImperativeChatAdapter | null = null;
  private mountGeneration = 0;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    plugin: ChatUiCompositionHost,
    getWorkspace: () => Promise<PiviPluginWorkspace>,
  ) {
    super(leaf);
    this.plugin = plugin;
    this.getWorkspace = getWorkspace;

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

  async onOpen(): Promise<void> {
    const generation = ++this.mountGeneration;
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
    container.createDiv({ cls: 'pivi-loading', text: appI18n.t('common.loading') });

    const workspace = await this.getWorkspace();
    if (generation !== this.mountGeneration) return;
    const ports = createChatUiPorts(this.plugin, workspace);
    container.empty();
    const chatAdapter = createImperativeChatAdapter({
      plugin: this.plugin,
      view: this,
      getContainerEl: () => this.containerEl,
      chatIcon: this.plugin.getUiFacades().chatUIConfig.getChatIcon?.() ?? null,
      persistTabState: state => this.persistTabState(state),
      persistTabStateImmediate: state => this.plugin.persistTabManagerState(state),
      loadPersistedTabState: () => this.plugin.loadTabManagerState(),
      activateOpenSessionElsewhere: openSessionId => (
        this.activateOpenSessionElsewhere(openSessionId)
      ),
    });
    this.chatAdapter = chatAdapter;

    const shell = chatAdapter.prepareShell(ownerDocument);
    const imperativeAdapter: ImperativeChatAdapter = {
      mount: async (adapterContainer, environment) => {
        await chatAdapter.mount(adapterContainer, environment, ports);
        this.wireEventHandlers();
      },
      dispose: () => this.disposeChatRuntimeSurface(),
    };

    try {
      this.mountedSurface = await mountChatView({
        container,
        ownerDocument,
        ownerWindow,
        portalContainer: ownerDocument.body,
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
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
    } catch (mountError) {
      try {
        await this.disposeChatRuntimeSurface();
      } catch (cleanupError) {
        throw new AggregateError(
          [mountError, cleanupError],
          'Pivi chat mount and cleanup both failed.',
        );
      }
      throw mountError;
    }
  }

  async onClose(): Promise<void> {
    this.mountGeneration += 1;
    const mountedSurface = this.mountedSurface;
    this.mountedSurface = null;
    if (mountedSurface) {
      await mountedSurface.dispose();
      return;
    }
    await this.disposeChatRuntimeSurface();
  }

  private async disposeChatRuntimeSurface(): Promise<void> {
    if (this.pendingPersist !== null) {
      getActiveWindow(this.containerEl).clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    const adapter = this.chatAdapter;
    this.chatAdapter = null;
    this.scope = null;

    const errors: unknown[] = [];
    try {
      await adapter?.getViewHandle().maintenance.persistState();
    } catch (error) {
      errors.push(error);
    }
    try {
      await adapter?.dispose();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Pivi chat persistence and disposal both failed.');
    }
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
        this.getChatHandle()?.commands.cancelActiveTurn();
      }
      return false;
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      this.getChatHandle()?.maintenance.markFileContextDirty(includesFolders);
    };
    this.registerEvent(this.plugin.app.vault.on('create', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('delete', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('rename', () => markCacheDirty(true)));
    this.registerEvent(this.plugin.app.vault.on('modify', () => markCacheDirty(false)));

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.getChatHandle()?.maintenance.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      this.getChatHandle()?.maintenance.dismissMentionDropdown(e.target as Node);
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private persistTabState(
    state: Parameters<ChatUiCompositionHost['persistTabManagerState']>[0],
  ): void {
    // Debounce persistence to avoid rapid writes (300ms delay)
    const win = getActiveWindow(this.containerEl);
    if (this.pendingPersist !== null) {
      win.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = win.setTimeout(() => {
      this.pendingPersist = null;
      this.plugin.persistTabManagerState(state).catch((error: unknown) => {
        // Best-effort debounce; onClose persists immediately.
        logger.warn('debounced tab state persist failed', error);
      });
    }, 300);
  }

  getChatHandle(): PiviChatViewHandle | null {
    return this.chatAdapter?.getViewHandle() ?? null;
  }

  private async activateOpenSessionElsewhere(openSessionId: string): Promise<boolean> {
    return activateOpenSessionElsewhere({
      views: this.plugin.getAllViews(),
      currentLeaf: this.leaf,
      openSessionId,
      revealLeaf: leaf => revealWorkspaceLeaf(this.plugin.app.workspace, leaf),
    });
  }
}
