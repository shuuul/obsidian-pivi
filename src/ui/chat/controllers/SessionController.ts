import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/PiChatService';

import type PiviPlugin from '@/app/PiviPluginHost';
import { TodoEventPresenter } from '@/ui/chat/stream/TodoEventPresenter';

import type { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';
import type { RichChatInput } from '../ui/RichChatInput';
import type { StatusPanel } from '../ui/StatusPanel';
import {
  createSessionGreeting,
  ensureWelcomeGreeting,
  setWelcomeVisibility,
} from './sessionWelcome';

export interface SessionControllerCallbacks {
  onNewSession?: () => void;
  onSessionLoaded?: () => void;
  onSessionSwitched?: () => void;
}

export interface SessionControllerDeps {
  plugin: PiviPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
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
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => PiChatService | null;
  ensureServiceForSession?: (openSession: OpenSessionState | null) => Promise<void> | void;
  dismissPendingInlinePrompts?: () => void;
}

export class SessionController {
  private deps: SessionControllerDeps;
  private callbacks: SessionControllerCallbacks;

  constructor(deps: SessionControllerDeps, callbacks: SessionControllerCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): PiChatService | null {
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
      this.getAgentService()?.syncSession(null, plugin.settings.persistentExternalContextPaths || []
      );

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'pivi-welcome' });
      welcomeEl.createDiv({ cls: 'pivi-welcome-greeting', text: this.getGreeting() });
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
      this.getAgentService()?.syncSession(null, plugin.settings.persistentExternalContextPaths || []
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
   * Skip switch when the tab already shows this openSession with messages.
   * Re-load when messages are empty (failed/partial hydrate).
   */
  private shouldSkipSwitchTo(openSessionId: string, _leafId?: string | null): boolean {
    if (openSessionId !== this.deps.state.currentOpenSessionId) {
      return false;
    }
    return this.deps.state.messages.length > 0;
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

      const openSession = await plugin.switchSession(id);
      if (!openSession) {
        return;
      }

      await this.deps.ensureServiceForSession?.(openSession);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      this.restoreOpenSession(openSession);

      this.updateWelcomeVisibility();

      this.callbacks.onSessionSwitched?.();
    } finally {
      state.isSwitchingSession = false;
    }
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
  async save(updateLastResponse = false): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentOpenSessionId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();

    // Entry point with messages - create openSession lazily.
    // New sessions always use SDK-native storage.
    if (!state.currentOpenSessionId && state.messages.length > 0) {
      const sessionUpdates = agentService?.getSessionStateUpdates() ?? {};
      const openSession = await plugin.createOpenSession({
        sessionId: agentService?.getSessionId() ?? undefined,
        sessionFile: sessionUpdates.sessionFile,
      });
      state.currentOpenSessionId = openSession.id;
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector?.getExternalContexts() ?? [];
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const enabledMcpServers = mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [];


    const { updates: sessionUpdates } = agentService
      ? { updates: agentService.getSessionStateUpdates() }
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

    // Rebuild todo visualization from persisted assistant tool calls.
    new TodoEventPresenter(state).restoreFromMessages(state.messages);

    const hasMessages = state.messages.length > 0;

    // Determine external context paths for this session
    // Empty session: use persistent paths; session with messages: use saved paths
    const externalContextPaths = hasMessages
      ? openSession.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);

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

}
