import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type {
  ChatPorts,
  ChatSettingsPort,
} from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';

import { TodoEventPresenter } from '@/ui/chat/stream/TodoEventPresenter';

import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { ExternalContextSelector } from '../toolbar/ExternalContextControl';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { RichChatInput } from '../ui/RichChatInput';
import { createSessionGreeting } from './sessionWelcome';

export interface SessionControllerCallbacks {
  onNewSession?: () => void;
  onSessionLoaded?: () => void;
  onSessionSwitched?: () => void;
}

export interface SessionControllerDeps {
  settings: ChatSettingsPort;
  sessions: ChatPorts['sessions'];
  state: ChatState;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => RichChatInput;
  getFileContextManager: () => FileContextManager | null;
  getInlineContextManager: () => InlineContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
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
    const { settings, state, subagentManager } = this.deps;
    const settingsSnapshot = settings.getSettingsSnapshot();
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

      // Clear serializable streaming state.
      state.currentTextContent = '';
      state.isStreaming = false;

      // Reset to entry point state - no openSession created yet
      state.currentOpenSessionId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.autoScrollEnabled = settingsSnapshot.enableAutoScroll;
      state.hasPendingSessionSave = false;

      // Reset agent service session (no session ID for entry point)
      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncSession(null, settingsSnapshot.externalReadDirectories);

      this.deps.getMessagesEl().empty();
      state.welcomeGreeting = this.getGreeting();

      this.deps.getInputEl().value = '';

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewSession();
      fileCtx?.autoAttachActiveFile();
      this.deps.getInlineContextManager()?.resetForNewSession();

      this.deps.getImageContextManager()?.clearImages();
      // Session-only roots expire here; current settings pins start checked.
      this.deps.getExternalContextSelector()?.resetForSession(
        settingsSnapshot.externalReadDirectories,
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
    const { settings, sessions, state } = this.deps;
    const settingsSnapshot = settings.getSettingsSnapshot();

    const openSessionId = state.currentOpenSessionId;
    const openSession = openSessionId ? await sessions.getOpenSession(openSessionId) : null;

    // No active openSession - start at entry point
    if (!openSession) {
      state.currentOpenSessionId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.autoScrollEnabled = settingsSnapshot.enableAutoScroll;
      state.hasPendingSessionSave = false;

      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncSession(null, settingsSnapshot.externalReadDirectories);

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewSession();
      fileCtx?.autoAttachActiveFile();
      this.deps.getInlineContextManager()?.resetForNewSession();

      this.deps.getExternalContextSelector()?.resetForSession(
        settingsSnapshot.externalReadDirectories,
      );

      state.welcomeGreeting = this.getGreeting();

      this.callbacks.onSessionLoaded?.();
      return;
    }

    await this.deps.ensureServiceForSession?.(openSession);
    this.restoreOpenSession(openSession, { autoAttachFile: true });

    this.callbacks.onSessionLoaded?.();
  }

  /**
   * Skip switch when the tab already shows this openSession with messages.
   * Re-load when messages are empty (failed/partial hydrate).
   */
  private shouldSkipSwitchTo(openSessionId: string): boolean {
    if (openSessionId !== this.deps.state.currentOpenSessionId) {
      return false;
    }
    return this.deps.state.messages.length > 0;
  }

  /** Switches to a different openSession. */
  async switchTo(id: string): Promise<void> {
    const { sessions, state, subagentManager } = this.deps;

    if (this.shouldSkipSwitchTo(id)) return;
    if (state.isStreaming) return;
    if (state.isSwitchingSession) return;
    if (state.isCreatingSession) return;

    state.isSwitchingSession = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();
      await this.save();

      subagentManager.orphanAllActive();
      subagentManager.clear();

      const openSession = await sessions.getOpenSession(id);
      if (!openSession) {
        return;
      }

      await this.deps.ensureServiceForSession?.(openSession);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      this.restoreOpenSession(openSession);


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
    const { sessions, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentOpenSessionId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();

    // Entry point with messages - create openSession lazily.
    // New sessions always use SDK-native storage.
    if (!state.currentOpenSessionId && state.messages.length > 0) {
      const sessionUpdates = agentService?.getSessionStateUpdates() ?? {};
      const openSession = await sessions.createSession({
        sessionId: agentService?.getSessionId() ?? undefined,
        sessionFile: sessionUpdates.sessionFile,
      });
      state.currentOpenSessionId = openSession.id;
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;

    const { updates: sessionUpdates } = agentService
      ? { updates: agentService.getSessionStateUpdates() }
      : { updates: {} };

    const updates: Partial<OpenSessionState> = {
      ...sessionUpdates,
      messages: state.messages,
      currentNote: currentNote,
      usage: state.usage ?? undefined,
      // Per-turn MCP toolbar selection removed; settings enable/disable owns availability.
      enabledMcpServers: undefined,
    };

    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }

    await sessions.updateSession(state.currentOpenSessionId!, updates);
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
    const { settings, state } = this.deps;
    const settingsSnapshot = settings.getSettingsSnapshot();

    state.currentOpenSessionId = openSession.id;
    state.messages = [...openSession.messages];
    state.usage = openSession.usage ?? null;
    state.autoScrollEnabled = settingsSnapshot.enableAutoScroll;
    state.hasPendingSessionSave = false;

    // Rebuild todo visualization from persisted assistant tool calls.
    new TodoEventPresenter(state).restoreFromMessages(state.messages);

    const hasMessages = state.messages.length > 0;

    const externalContextPaths = settingsSnapshot.externalReadDirectories;

    // External context selection is intentionally ephemeral across sessions.
    this.deps.getExternalContextSelector()?.resetForSession(externalContextPaths);

    this.getAgentService()?.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);

    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedSession(hasMessages);
    this.deps.getInlineContextManager()?.resetForLoadedSession(hasMessages);

    if (openSession.currentNote) {
      fileCtx?.setCurrentNote(openSession.currentNote);
    } else if (!hasMessages && options?.autoAttachFile) {
      fileCtx?.autoAttachActiveFile();
    }

    // Legacy open-session enabledMcpServers fields are ignored; settings enable/disable owns MCP.
    state.welcomeGreeting = state.messages.length === 0 ? this.getGreeting() : null;
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    return createSessionGreeting({
      userName: this.deps.settings.getSettingsSnapshot().userName,
    });
  }

  /**
   * Initializes the welcome greeting for a new tab without an open session.
   * Called when a new tab is activated and has no open session loaded.
   */
  initializeWelcome(): void {
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewSession();
    fileCtx?.autoAttachActiveFile();
    this.deps.getInlineContextManager()?.resetForNewSession();
    this.deps.state.welcomeGreeting = this.getGreeting();
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const [firstSentence = ''] = firstMessage.split(/[.!?\n]/);
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

}
