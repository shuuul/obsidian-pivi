import { Menu, Notice, setIcon } from 'obsidian';

import type { TitleGenerationService } from '../../../core/agent/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatRewindMode } from '../../../core/runtime/types';
import type { OpenSessionState } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ObsiusPlugin from '../../../main';
import { confirm } from '../../../shared/modals/ConfirmModal';
import { resolveUserMessageDisplayText } from '../../../utils/context';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { findRewindContext } from '../rewind';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';
import type { RichChatInput } from '../ui/RichChatInput';
import type { StatusPanel } from '../ui/StatusPanel';
import { renderHistoryBranches } from './sessionHistoryBranchRenderer';
import {
  createSessionGreeting,
  ensureWelcomeGreeting,
  setWelcomeVisibility,
} from './sessionWelcome';

export { formatLeafLabel, formatLeafMeta } from './sessionHistoryBranchRenderer';

function runSessionAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface SessionControllerCallbacks {
  onNewSession?: () => void;
  onSessionLoaded?: () => void;
  onSessionSwitched?: () => void;
}

export interface SessionControllerDeps {
  plugin: ObsiusPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => RichChatInput;
  getFileContextManager: () => FileContextManager | null;
  getInlineContextManager: () => InlineContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => ChatRuntime | null;
  ensureServiceForSession?: (openSession: OpenSessionState | null) => Promise<void> | void;
  dismissPendingInlinePrompts?: () => void;
}

type SaveOptions = {
  resumeAtMessageId?: string;
};

export type HistorySessionOpenState = 'closed' | 'open' | 'current';

type HistoryRenderOptions = {
  onSelectSession: (id: string, leafId?: string | null) => Promise<void>;
  onOpenSessionInNewTab?: (id: string, activate?: boolean, leafId?: string | null) => Promise<void>;
  getSessionOpenState?: (id: string) => HistorySessionOpenState;
  onRerender: () => void;
};

export function formatSessionBranchCount(leafCount?: number): string | null {
  if (typeof leafCount !== 'number' || leafCount <= 1) {
    return null;
  }
  return `${leafCount} branches`;
}

export class SessionController {
  private deps: SessionControllerDeps;
  private callbacks: SessionControllerCallbacks;

  constructor(deps: SessionControllerDeps, callbacks: SessionControllerCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  // ============================================
  // Session lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no openSession is created until the
   * first message is sent. This prevents empty sessions cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingSession) return;
    if (state.isSwitchingSession) return;

    // Set flag to block message sending during reset
    state.isCreatingSession = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();

      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        this.getAgentService()?.cancel();
      }

      // Save current openSession if it has messages
      if (state.currentOpenSessionId && state.messages.length > 0) {
        await this.save();
      }

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Clear streaming state and related DOM references
      cleanupThinkingBlock(state.currentThinkingState);
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no openSession created yet
      state.currentOpenSessionId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingSessionSave = false;

      // Reset agent service session (no session ID for entry point)
      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncOpenSessionState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'obsius2-welcome' });
      welcomeEl.createDiv({ cls: 'obsius2-welcome-greeting', text: this.getGreeting() });
      this.deps.setWelcomeEl(welcomeEl);

      // Remount StatusPanel to restore state for new session
      this.deps.getStatusPanel()?.remount();

      this.deps.getInputEl().value = '';

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewSession();
      fileCtx?.autoAttachActiveFile();
      this.deps.getInlineContextManager()?.resetForNewSession();

      this.deps.getImageContextManager()?.clearImages();
      this.deps.getMcpServerSelector()?.clearEnabled();
      // Pass current settings to ensure we have the most up-to-date persistent paths
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
      this.deps.clearQueuedMessage();

      this.callbacks.onNewSession?.();
    } finally {
      state.isCreatingSession = false;
    }
  }

  /**
   * Loads the current tab openSession, or starts at entry point if none.
   *
   * Entry point (no openSession) shows welcome screen without
   * creating a openSession. Open session state is created lazily on first message.
   */
  async loadActive(): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const openSessionId = state.currentOpenSessionId;
    const openSession = openSessionId ? await plugin.getOpenSessionById(openSessionId) : null;

    // No active openSession - start at entry point
    if (!openSession) {
      state.currentOpenSessionId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingSessionSave = false;

      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncOpenSessionState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewSession();
      fileCtx?.autoAttachActiveFile();
      this.deps.getInlineContextManager()?.resetForNewSession();

      // Initialize external contexts with persistent paths from settings
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );

      this.deps.getMcpServerSelector()?.clearEnabled();

      const welcomeEl = renderer.renderMessages(
        [],
        () => this.getGreeting()
      );
      this.deps.setWelcomeEl(welcomeEl);
      this.updateWelcomeVisibility();

      this.callbacks.onSessionLoaded?.();
      return;
    }

    await this.deps.ensureServiceForSession?.(openSession);
    this.restoreOpenSession(openSession, { autoAttachFile: true });
    this.updateWelcomeVisibility();

    this.callbacks.onSessionLoaded?.();
  }

  /**
   * Skip switch when the tab already shows this openSession+leaf with messages.
   * Re-load when messages are empty (failed/partial hydrate) or the leaf changes.
   */
  private shouldSkipSwitchTo(openSessionId: string, leafId?: string | null): boolean {
    if (openSessionId !== this.deps.state.currentOpenSessionId) {
      return false;
    }
    if (this.deps.state.messages.length === 0) {
      return false;
    }
    if (leafId === undefined) {
      return true;
    }
    const activeLeaf = this.deps.plugin.getOpenSessionSync(openSessionId)?.leafId ?? null;
    return leafId === activeLeaf;
  }

  /** Switches to a different openSession. */
  async switchTo(id: string, leafId?: string | null): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;

    if (this.shouldSkipSwitchTo(id, leafId)) return;
    if (state.isStreaming) return;
    if (state.isSwitchingSession) return;
    if (state.isCreatingSession) return;

    state.isSwitchingSession = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();
      await this.save();

      subagentManager.orphanAllActive();
      subagentManager.clear();

      const openSession = await plugin.switchSession(id, leafId);
      if (!openSession) {
        return;
      }

      await this.deps.ensureServiceForSession?.(openSession);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      this.restoreOpenSession(openSession);

      this.deps.getHistoryDropdown()?.removeClass('visible');
      this.updateWelcomeVisibility();

      this.callbacks.onSessionSwitched?.();
    } finally {
      state.isSwitchingSession = false;
    }
  }

  async rewind(
    userMessageId: string,
    mode: ChatRewindMode = 'code-and-session',
  ): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const agentServiceForCheck = this.getAgentService();
    if (agentServiceForCheck && !agentServiceForCheck.getCapabilities().supportsRewind) {
      new Notice(t('chat.rewind.failed', { error: 'Rewind is not available in the current runtime.' }));
      return;
    }

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const msgs = state.messages;
    const userIdx = msgs.findIndex(m => m.id === userMessageId);
    if (userIdx === -1) {
      new Notice(t('chat.rewind.failed', { error: 'Message not found' }));
      return;
    }
    const userMsg = msgs[userIdx];
    if (!userMsg.userMessageId) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }

    const rewindCtx = findRewindContext(msgs, userIdx);
    if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }
    const prevAssistantUuid = rewindCtx.prevAssistantUuid;

    const confirmed = await confirm(
      plugin.app,
      mode === 'session'
        ? t('chat.rewind.confirmMessageSessionOnly')
        : t('chat.rewind.confirmMessage'),
      t('chat.rewind.confirmButton')
    );
    if (!confirmed) return;

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice(t('chat.rewind.failed', { error: 'Agent service not available' }));
      return;
    }

    let result;
    try {
      result = await agentService.rewind(userMsg.userMessageId, prevAssistantUuid, mode);
    } catch (e) {
      new Notice(t('chat.rewind.failed', { error: e instanceof Error ? e.message : 'Unknown error' }));
      return;
    }
    if (!result.canRewind) {
      new Notice(t('chat.rewind.cannot', { error: result.error ?? 'Unknown error' }));
      return;
    }

    state.truncateAt(userMessageId);

    const inputEl = this.deps.getInputEl();
    inputEl.value = userMsg.content;
    inputEl.focus();

    const welcomeEl = renderer.renderMessages(state.messages, () => this.getGreeting());
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();

    const filesChanged = result.filesChanged?.length ?? 0;
    let saveError: string | null = null;
    try {
      await this.save(false, { resumeAtMessageId: prevAssistantUuid });
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save';
    }

    if (saveError) {
      new Notice(
        mode === 'session'
          ? t('chat.rewind.noticeSessionOnlySaveFailed', { error: saveError })
          : t('chat.rewind.noticeSaveFailed', { count: String(filesChanged), error: saveError })
      );
      return;
    }

    new Notice(
      mode === 'session'
        ? t('chat.rewind.noticeSessionOnly')
        : t('chat.rewind.notice', { count: String(filesChanged) })
    );
  }

  /**
   * Saves the current openSession.
   *
   * If we're at an entry point (no openSession yet) and have messages,
   * creates a new session first (lazy creation).
   *
   * For native sessions (new sessions with sessionId from SDK),
   * only metadata is saved - the SDK handles message persistence.
   */
  async save(updateLastResponse = false, options?: SaveOptions): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentOpenSessionId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();
    const sessionInvalidated = agentService?.consumeSessionInvalidation?.() ?? false;

    // Entry point with messages - create openSession lazily
    // New sessions always use SDK-native storage.
    if (!state.currentOpenSessionId && state.messages.length > 0) {
      const initialSessionId = agentService?.getSessionId() ?? undefined;
      const built = agentService
        ? agentService.buildSessionUpdates({ openSession: null, sessionInvalidated: false })
        : { updates: {} };
      const openSession = await plugin.createOpenSession({
        sessionId: initialSessionId,
        sessionFile: built.updates.sessionFile,
        leafId: built.updates.leafId ?? null,
      });
      state.currentOpenSessionId = openSession.id;
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector?.getExternalContexts() ?? [];
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const enabledMcpServers = mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [];

    const openSession = plugin.getOpenSessionSync(state.currentOpenSessionId!);

    const { updates: sessionUpdates } = agentService
      ? agentService.buildSessionUpdates({ openSession, sessionInvalidated })
      : { updates: {} };

    const updates: Partial<OpenSessionState> = {
      ...sessionUpdates,
      messages: state.messages,
      currentNote: currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : undefined,
      usage: state.usage ?? undefined,
      enabledMcpServers: enabledMcpServers.length > 0 ? enabledMcpServers : undefined,
    };

    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }

    if (options) {
      updates.resumeAtMessageId = options.resumeAtMessageId;
    }

    await plugin.updateSession(state.currentOpenSessionId!, updates);
    state.hasPendingSessionSave = false;
  }

  /**
   * Shared logic for restoring a openSession into the current tab.
   * Used by both loadActive() and switchTo() to avoid duplication.
   */
  private restoreOpenSession(
    openSession: OpenSessionState,
    options?: { autoAttachFile?: boolean }
  ): void {
    const { plugin, state, renderer } = this.deps;

    state.currentOpenSessionId = openSession.id;
    state.messages = [...openSession.messages];
    state.usage = openSession.usage ?? null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    state.hasPendingSessionSave = false;

    // Clear status panels (auto-hide: panels reappear when agent creates new todos)
    state.currentTodos = null;

    const hasMessages = state.messages.length > 0;

    // Determine external context paths for this session
    // Empty session: use persistent paths; session with messages: use saved paths
    const externalContextPaths = hasMessages
      ? openSession.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.syncOpenSessionState(openSession, externalContextPaths);

    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedSession(hasMessages);
    this.deps.getInlineContextManager()?.resetForLoadedSession(hasMessages);

    if (openSession.currentNote) {
      fileCtx?.setCurrentNote(openSession.currentNote);
    } else if (!hasMessages && options?.autoAttachFile) {
      fileCtx?.autoAttachActiveFile();
    }

    this.restoreExternalContextPaths(openSession.externalContextPaths, !hasMessages);

    const mcpServerSelector = this.deps.getMcpServerSelector();
    if (openSession.enabledMcpServers && openSession.enabledMcpServers.length > 0) {
      mcpServerSelector?.setEnabledServers(openSession.enabledMcpServers);
    } else {
      mcpServerSelector?.clearEnabled();
    }

    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting()
    );
    this.deps.setWelcomeEl(welcomeEl);
  }

  /**
   * Restores external context paths based on session state.
   * New or empty sessions get current persistent paths from settings.
   * Sessions with messages restore exactly what was saved.
   */
  private restoreExternalContextPaths(
    savedPaths: string[] | undefined,
    isEmptySession: boolean
  ): void {
    const { plugin } = this.deps;
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (!externalContextSelector) {
      return;
    }

    if (isEmptySession) {
      // Empty session: use current persistent paths from settings
      externalContextSelector.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
    } else {
      // Session with messages: restore exactly what was saved
      externalContextSelector.setExternalContexts(savedPaths || []);
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectSession: (id, leafId) => this.switchTo(id, leafId),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders history dropdown items to a container.
   * Shared implementation for updateHistoryDropdown() and renderHistoryDropdown().
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: HistoryRenderOptions
  ): void {
    const { plugin, state } = this.deps;

    container.empty();

    const dropdownHeader = container.createDiv({ cls: 'obsius2-history-header' });
    dropdownHeader.createSpan({ text: 'Sessions' });

    const list = container.createDiv({ cls: 'obsius2-history-list' });
    const allSessions = plugin.getSessionList();

    if (allSessions.length === 0) {
      list.createDiv({ cls: 'obsius2-history-empty', text: 'No sessions' });
      return;
    }

    // Sort by lastResponseAt (fallback to createdAt) descending
    const sessions = [...allSessions].sort((a, b) => {
      return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
    });

    for (const conv of sessions) {
      const isCurrent = conv.id === state.currentOpenSessionId;
      const itemContainer = list.createDiv({
        cls: 'obsius2-history-item-container',
      });

      const item = itemContainer.createDiv({
        cls: `obsius2-history-item${isCurrent ? ' active' : ''}`,
      });

      const branchCountLabel = formatSessionBranchCount(conv.leafCount);
      const hasBranches = branchCountLabel !== null;

      const expandBtn = item.createDiv({
        cls: 'obsius2-history-item-expand' + (hasBranches ? '' : ' obsius2-history-item-expand-placeholder'),
      });
      if (hasBranches) {
        setIcon(expandBtn, 'chevron-right');
      }

      const iconEl = item.createDiv({ cls: 'obsius2-history-item-icon' });
      setIcon(iconEl, isCurrent ? 'message-square-dot' : 'message-square');

      const content = item.createDiv({ cls: 'obsius2-history-item-content' });
      const titleEl = content.createDiv({ cls: 'obsius2-history-item-title', text: conv.title });
      titleEl.setAttribute('title', conv.title);
      const metaText = isCurrent ? 'Current tab' : this.formatDate(conv.lastResponseAt ?? conv.createdAt);
      const itemMeta = content.createDiv({
        cls: 'obsius2-history-item-date',
        text: branchCountLabel ? `${metaText} · ${branchCountLabel}` : metaText,
      });
      itemMeta.setAttribute(
        'title',
        isCurrent
          ? 'This session is open in the current tab. Click a branch below to switch leaves.'
          : 'Click to open in the current tab. Ctrl/Cmd-click or middle-click to open in a new tab.',
      );

      if (!isCurrent) {
        content.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.isHistoryNewTabModifierClick(e) && options.onOpenSessionInNewTab) {
            e.preventDefault();
            runSessionAction(
              () => this.runHistoryAction(
                () => options.onOpenSessionInNewTab?.(conv.id, true),
                'Failed to load session',
              ),
              'Failed to load session',
            );
            return;
          }

          runSessionAction(
            () => this.runHistoryAction(
              () => options.onSelectSession(conv.id),
              'Failed to load session',
            ),
            'Failed to load session',
          );
        });

        if (options.onOpenSessionInNewTab) {
          content.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            runSessionAction(
              () => this.runHistoryAction(
                () => options.onOpenSessionInNewTab?.(conv.id, true),
                'Failed to load session',
              ),
              'Failed to load session',
            );
          });
        }
      }

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showHistoryContextMenu(item, conv.id, conv.title, isCurrent, options, e);
      });

      const actions = item.createDiv({ cls: 'obsius2-history-item-actions' });

      // Show regenerate button if title generation failed, or loading indicator if pending
      if (conv.titleGenerationStatus === 'pending') {
        const loadingEl = actions.createEl('span', { cls: 'obsius2-action-btn obsius2-action-loading' });
        setIcon(loadingEl, 'loader-2');
        loadingEl.setAttribute('aria-label', 'Generating title...');
      } else if (conv.titleGenerationStatus === 'failed') {
        const regenerateBtn = actions.createEl('button', { cls: 'obsius2-action-btn' });
        setIcon(regenerateBtn, 'refresh-cw');
        regenerateBtn.setAttribute('aria-label', 'Regenerate title');
        regenerateBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          runSessionAction(
            () => this.regenerateTitle(conv.id),
            'Failed to regenerate response',
          );
        });
      }

      const renameBtn = actions.createEl('button', { cls: 'obsius2-action-btn' });
      setIcon(renameBtn, 'pencil');
      renameBtn.setAttribute('aria-label', 'Rename');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRenameInput(item, conv.id, conv.title);
      });

      const deleteBtn = actions.createEl('button', { cls: 'obsius2-action-btn obsius2-delete-btn' });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runSessionAction(
          () => this.runHistoryAction(
            () => this.deleteHistorySession(conv.id, options),
            'Failed to delete session',
          ),
          'Failed to delete session',
        );
      });

      // Render collapsible branches if multi-branch
      if (hasBranches) {
        renderHistoryBranches({
          itemContainer,
          expandBtn,
          sessionId: conv.id,
          sessionFile: conv.sessionFile,
          activeLeafId: conv.leafId,
          isCurrent,
          formatDate: (time) => this.formatDate(time),
          isNewTabModifierClick: (event) => this.isHistoryNewTabModifierClick(event),
          runHistoryAction: (action, errorMessage) => this.runHistoryAction(action, errorMessage),
          onSelectSession: options.onSelectSession,
          onOpenSessionInNewTab: options.onOpenSessionInNewTab,
        });
      }
    }
  }

  private isHistoryNewTabModifierClick(event: MouseEvent): boolean {
    return !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey);
  }

  private async runHistoryAction(
    action: () => Promise<void> | void,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(errorMessage);
    }
  }

  private showHistoryContextMenu(
    item: HTMLElement,
    openSessionId: string,
    title: string,
    isCurrent: boolean,
    options: HistoryRenderOptions,
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    const openState = options.getSessionOpenState?.(openSessionId) ?? (isCurrent ? 'current' : 'closed');

    if (!isCurrent) {
      if (openState === 'closed' && options.onOpenSessionInNewTab) {
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in new tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenSessionInNewTab?.(openSessionId, true),
              'Failed to load session',
            );
          }));
        menu.addItem((menuItem) => menuItem
          .setTitle('Open in background tab')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenSessionInNewTab?.(openSessionId, false),
              'Failed to load session',
            );
          }));
      } else if (openState === 'open') {
        menu.addItem((menuItem) => menuItem
          .setTitle('Switch to open session')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onSelectSession(openSessionId),
              'Failed to load session',
            );
          }));
      }
    }

    menu.addItem((menuItem) => menuItem
      .setTitle('Rename')
      .onClick(() => {
        this.showRenameInput(item, openSessionId, title);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle('Delete')
      .onClick(() => {
        void this.runHistoryAction(
          () => this.deleteHistorySession(openSessionId, options),
          'Failed to delete session',
        );
      }));

    menu.showAtMouseEvent(event);
  }

  private async deleteHistorySession(
    openSessionId: string,
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    if (state.isStreaming) return;

    await plugin.deleteSession(openSessionId);
    options.onRerender();

    if (openSessionId === state.currentOpenSessionId) {
      await this.loadActive();
    }
  }

  /** Shows inline rename input for a openSession. */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string): void {
    const titleEl = item.querySelector('.obsius2-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = (item.ownerDocument ?? window.document).createElement('input');
    input.type = 'text';
    input.className = 'obsius2-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      try {
        const newTitle = input.value.trim() || currentTitle;
        await this.deps.plugin.renameSession(convId, newTitle);
        this.updateHistoryDropdown();
      } catch {
        new Notice('Failed to rename session');
      }
    };

    input.addEventListener('blur', () => {
      runSessionAction(finishRename, 'Failed to rename session');
    });
    input.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    return createSessionGreeting({ userName: this.deps.plugin.settings.userName });
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    setWelcomeVisibility(this.deps.getWelcomeEl(), this.deps.state.messages.length > 0);
  }

  /**
   * Initializes the welcome greeting for a new tab without a openSession.
   * Called when a new tab is activated and has no openSession loaded.
   */
  initializeWelcome(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    // Initialize file context to auto-attach the currently focused note
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewSession();
    fileCtx?.autoAttachActiveFile();
    this.deps.getInlineContextManager()?.resetForNewSession();

    ensureWelcomeGreeting(welcomeEl, () => this.getGreeting());

    this.updateWelcomeVisibility();
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Regenerates AI title for a openSession. */
  async regenerateTitle(openSessionId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;

    // Title generation is delegated to the active provider service
    const fullConv = await plugin.getOpenSessionById(openSessionId);
    if (!fullConv || fullConv.messages.length < 1) return;

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = resolveUserMessageDisplayText(firstUserMsg);

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateSession(openSessionId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      openSessionId,
      userContent,
      async (convId, result) => {
        // Check if openSession still exists and user hasn't manually renamed
        const currentConv = await plugin.getOpenSessionById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameSession(convId, result.title);
          await plugin.updateSession(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateSession(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateSession(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ============================================
  // History Dropdown Rendering (for ObsiusView)
  // ============================================

  /**
   * Renders the history dropdown content to a provided container.
   * Used by ObsiusView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: Omit<HistoryRenderOptions, 'onRerender'>,
  ): void {
    this.renderHistoryItems(container, {
      ...options,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
