import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '@pivi/core';
import type { TitleGenerationService } from '@pivi/pi-runtime/auxTypes';
import type { PiChatService } from '@pivi/pi-runtime/PiChatService';
import type {
  ApprovalCallbackOptions,
  ChatTurnRequest,
} from '@pivi/pi-runtime/types';
import { TOOL_EXIT_PLAN_MODE } from '@pivi/tools/toolNames';
import { Notice } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { ComposerApprovals } from '@/ui/chat/composer/ComposerApprovals';
import { resolvePlanCompletionFollowUp } from '@/ui/chat/composer/ComposerPlanFollowUp';
import {
  cloneQueuedMessage,
  toQueuedChatTurn,
} from '@/ui/chat/composer/ComposerQueue';
import { renderQueueIndicator } from '@/ui/chat/composer/ComposerQueueIndicator';
import { restoreQueuedMessageToInput } from '@/ui/chat/composer/ComposerQueueRestore';
import { captureResponseDurationFooter } from '@/ui/chat/composer/ComposerResponseDuration';
import { queueTurnWhileStreaming } from '@/ui/chat/composer/ComposerStreamingQueue';
import { beginOutgoingTurn } from '@/ui/chat/composer/ComposerTurnLifecycle';
import { getActiveWindow } from '@/ui/shared/dom';

import type { BrowserSelectionContext } from '../../shared/utils/browser';
import type { CanvasSelectionContext } from '../../shared/utils/canvas';
import type { EditorSelectionContext } from '../../shared/utils/editor';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { RichChatInput } from '../ui/RichChatInput';
import type { StatusPanel } from '../ui/StatusPanel';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import {
  isAssistantMessageStartChunk,
  isUserMessageStartChunk,
  shouldDiscardPendingAssistantPlaceholder,
  shouldIgnoreAssistantContinuationBoundary,
} from './inputProviderBoundary';
import type { SelectionController } from './SelectionController';
import type { SessionController } from './SessionController';
import type { StreamController } from './StreamController';
import { TitleGenerationCoordinator } from './TitleGenerationCoordinator';

interface FinalizeOutgoingTurnOptions {
  streamGeneration: number;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  wasInterrupted: boolean;
  wasInvalidated: boolean;
  planCompleted: boolean;
}

export interface InputControllerDeps {
  plugin: PiviPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  openSessionController: SessionController;
  getInputEl: () => RichChatInput;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getInlineContextManager: () => InlineContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;

  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  getAuxiliaryModel?: () => string | null;
  getAgentService?: () => PiChatService | null;
  getSubagentManager: () => SubagentManager;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openSession?: (openSessionId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
}

export class InputController {
  private deps: InputControllerDeps;
  private approvals: ComposerApprovals;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }> = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;
  private titleGenerationCoordinator: TitleGenerationCoordinator;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    this.approvals = new ComposerApprovals({
      state: deps.state,
      renderer: deps.renderer,
      streamController: deps.streamController,
      getInputContainerEl: () => deps.getInputContainerEl(),
    });
    this.titleGenerationCoordinator = new TitleGenerationCoordinator({
      plugin: deps.plugin,
      state: deps.state,
      openSessionController: deps.openSessionController,
      getTitleGenerationService: deps.getTitleGenerationService,
      getAgentService: () => this.getAgentService(),
      ensureServiceInitialized: deps.ensureServiceInitialized,
    });
  }

  private getAgentService(): PiChatService | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    const {
      plugin,
      state,
      renderer,
      streamController,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    // During session creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingSession || state.isSwitchingSession) return;

    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();
    const inlineContextManager = this.deps.getInlineContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const content = (contentOverride ?? inputEl.value).trim();
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages) return;

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      queueTurnWhileStreaming({
        state,
        inputEl,
        imageContextManager,
        inlineContextManager,
        selectionController,
        browserSelectionController,
        canvasSelectionController,
        getFileContextManager: () => this.deps.getFileContextManager(),
        getMcpServerSelector: () => this.deps.getMcpServerSelector(),
        getExternalContextSelector: () => this.deps.getExternalContextSelector(),
        resetInputHeight: () => this.deps.resetInputHeight(),
        updateQueueIndicator: () => this.updateQueueIndicator(),
      }, {
        content,
        shouldUseInput,
        hasImages,
        imageOverride,
      });
      return;
    }

    const {
      streamGeneration,
      displayContent,
      turnRequest,
      userMsg,
      assistantMsg,
      imagesForMessage,
      isCompact,
    } = beginOutgoingTurn({
      plugin,
      state,
      renderer,
      inputEl,
      imageContextManager,
      fileContextManager,
      inlineContextManager,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
      getWelcomeEl: () => this.deps.getWelcomeEl(),
      getFileContextManager: () => this.deps.getFileContextManager(),
      getMcpServerSelector: () => this.deps.getMcpServerSelector(),
      getExternalContextSelector: () => this.deps.getExternalContextSelector(),
      getSubagentManager: () => this.deps.getSubagentManager(),
      generateId: () => this.deps.generateId(),
      resetInputHeight: () => this.deps.resetInputHeight(),
    }, {
      content,
      shouldUseInput,
      imageOverride,
      turnRequestOverride: options?.turnRequestOverride,
      editorContextOverride: options?.editorContextOverride,
      browserContextOverride: options?.browserContextOverride,
      canvasContextOverride: options?.canvasContextOverride,
    });

    try {
      await this.titleGenerationCoordinator.triggerTitleGeneration();
    } catch (error) {
      console.error('Pivi: title generation setup failed', error);
    }

    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'pivi-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    let wasInterrupted = false;
    let wasInvalidated = false;
    const planCompleted = false;

    const agentService = await this.getReadyAgentService();
    if (!agentService) {
      return;
    }

    try {
      ({ wasInterrupted, wasInvalidated } = await this.runOutgoingTurnQuery({
        agentService,
        turnRequest,
        userMsg,
        assistantMsg,
        streamGeneration,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await streamController.appendText(`\n\n**Error:** ${errorMsg}`);
    } finally {
      await this.finalizeOutgoingTurn({
        streamGeneration,
        userMsg,
        assistantMsg,
        wasInterrupted,
        wasInvalidated,
        planCompleted,
      });
    }
  }

  private async getReadyAgentService(): Promise<PiChatService | null> {
    const { state, streamController } = this.deps;

    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice('Failed to initialize agent service. Please try again.');
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        return null;
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice('Agent service not available. Please reload the plugin.');
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      return null;
    }

    return agentService;
  }

  private async runOutgoingTurnQuery(options: {
    agentService: PiChatService;
    turnRequest: ChatTurnRequest;
    userMsg: ChatMessage;
    assistantMsg: ChatMessage;
    streamGeneration: number;
  }): Promise<{ wasInterrupted: boolean; wasInvalidated: boolean }> {
    const { state, streamController } = this.deps;
    const preparedTurn = options.agentService.prepareTurn(options.turnRequest);
    options.userMsg.content = preparedTurn.persistedContent;
    options.userMsg.currentNote = preparedTurn.isCompact
      ? undefined
      : preparedTurn.request.currentNotePath;

    // Pass history WITHOUT current turn (userMsg + assistantMsg we just added).
    // This prevents duplication when rebuilding context for new sessions.
    const previousMessages = state.messages.slice(0, -2);
    for await (const chunk of options.agentService.query(preparedTurn, previousMessages)) {
      if (state.streamGeneration !== options.streamGeneration) {
        return { wasInterrupted: false, wasInvalidated: true };
      }
      if (state.cancelRequested) {
        return { wasInterrupted: true, wasInvalidated: false };
      }

      if (await this.handleProviderMessageBoundaryChunk(chunk)) {
        continue;
      }

      await streamController.handleStreamChunk(
        chunk,
        this.activeStreamingAssistantMessage ?? options.assistantMsg,
      );
    }

    return { wasInterrupted: false, wasInvalidated: false };
  }

  private async finalizeOutgoingTurn(options: FinalizeOutgoingTurnOptions): Promise<void> {
    const { state } = this.deps;
    const agentService = this.getAgentService();
    const finalAssistantMsg = this.activeStreamingAssistantMessage ?? options.assistantMsg;

    if (agentService) {
      const turnMetadata = agentService.consumeTurnMetadata();
      options.userMsg.userMessageId = turnMetadata.userMessageId ?? options.userMsg.userMessageId;
      options.userMsg.parentEntryId = turnMetadata.userParentEntryId !== undefined
        ? turnMetadata.userParentEntryId
        : options.userMsg.parentEntryId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      options.planCompleted = options.planCompleted || turnMetadata.planCompleted === true;
    }

    // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
    state.clearFlavorTimerInterval();

    if (!options.wasInvalidated && state.streamGeneration === options.streamGeneration) {
      await this.finalizeCurrentOutgoingTurn({
        ...options,
        finalAssistantMsg,
      });
    }

    if (options.wasInvalidated) {
      this.updateQueueIndicator();
    }

    this.activeStreamingAssistantMessage = null;
    this.resetProviderMessageBoundaryState();
  }

  private async finalizeCurrentOutgoingTurn(
    options: FinalizeOutgoingTurnOptions & { finalAssistantMsg: ChatMessage },
  ): Promise<void> {
    const { state, streamController } = this.deps;
    const didCancelThisTurn = options.wasInterrupted || state.cancelRequested;

    if (didCancelThisTurn && !state.pendingNewSessionPlan) {
      await streamController.appendText('\n\n<span class="pivi-interrupted">Interrupted</span> <span class="pivi-interrupted-hint">· What should Pivi do instead?</span>');
    }
    streamController.hideThinkingIndicator();
    state.isStreaming = false;
    state.cancelRequested = false;

    captureResponseDurationFooter({
      message: options.finalAssistantMsg,
      responseStartTime: state.responseStartTime,
      currentContentEl: state.currentContentEl,
      didCancelThisTurn,
    });

    state.currentContentEl = null;

    await streamController.finalizeCurrentThinkingBlock(options.finalAssistantMsg);
    await streamController.finalizeCurrentTextBlock(options.finalAssistantMsg);
    this.deps.getSubagentManager().resetStreamingState();

    this.clearCompletedTodos();
    this.syncScrollToBottomAfterRenderUpdates();
    this.markApprovedNewSessionPlanToolResult(options.finalAssistantMsg);
    await this.saveAndDispatchTurnFollowUp(options, didCancelThisTurn);
  }

  private clearCompletedTodos(): void {
    const { state } = this.deps;
    // Auto-hide completed todo panel on response end. Panel reappears only when
    // a new TodoWrite tool is called.
    if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
      state.currentTodos = null;
    }
  }

  private markApprovedNewSessionPlanToolResult(finalAssistantMsg: ChatMessage): void {
    const { state } = this.deps;
    // approve-new-session: the tool_result chunk is dropped because cancelRequested
    // was set before the stream loop could process it — manually set the result so
    // the saved session renders correctly when revisited
    if (!state.pendingNewSessionPlan || !finalAssistantMsg.toolCalls) {
      return;
    }

    for (const tc of finalAssistantMsg.toolCalls) {
      if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
        tc.status = 'completed';
        tc.result = 'User approved the plan and started a new session.';
        updateToolCallResult(tc.id, tc, state.toolCallElements);
      }
    }
  }

  private async saveAndDispatchTurnFollowUp(
    options: FinalizeOutgoingTurnOptions & { finalAssistantMsg: ChatMessage },
    didCancelThisTurn: boolean,
  ): Promise<void> {
    const { state, renderer, openSessionController } = this.deps;
    const planFollowUp = await resolvePlanCompletionFollowUp({
      planCompleted: options.planCompleted,
      didCancelThisTurn,
      streamGeneration: options.streamGeneration,
      getCurrentStreamGeneration: () => state.streamGeneration,
      showPlanApproval: () => this.showPlanApproval(),
      restorePrePlanPermissionModeIfNeeded: () => {
        this.deps.restorePrePlanPermissionModeIfNeeded?.();
      },
      setInputValue: (value) => {
        this.deps.getInputEl().value = value;
      },
    });

    if (planFollowUp.invalidated) {
      return;
    }

    await openSessionController.save(true);

    const userMsgIndex = state.messages.indexOf(options.userMsg);
    renderer.refreshActionButtons(options.userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);
    const assistantMsgIndex = state.messages.indexOf(options.finalAssistantMsg);
    renderer.refreshActionButtons(
      options.finalAssistantMsg,
      state.messages,
      assistantMsgIndex >= 0 ? assistantMsgIndex : undefined,
    );

    await this.dispatchTurnFollowUp(planFollowUp);
  }

  private async dispatchTurnFollowUp(
    planFollowUp: { autoSendContent: string | null; shouldProcessQueuedMessage: boolean },
  ): Promise<void> {
    // Auto-implement takes precedence over both approve-new-session and queued input
    if (planFollowUp.autoSendContent) {
      this.deps.getInputEl().value = planFollowUp.autoSendContent;
      this.sendMessage().catch(() => {});
      return;
    }

    // approve-new-session: create fresh openSession and send plan content. Must
    // remain after the invalidation guard — if the tab was closed or session
    // switched, we must not create a new session on stale state.
    const planContent = this.deps.state.pendingNewSessionPlan;
    if (planContent) {
      this.deps.state.pendingNewSessionPlan = null;
      await this.deps.openSessionController.createNew();
      this.deps.getInputEl().value = planContent;
      this.sendMessage().catch(() => {
        // sendMessage() handles its own errors internally; this prevents
        // unhandled rejection if an unexpected error slips through.
      });
      return;
    }

    if (planFollowUp.shouldProcessQueuedMessage) {
      this.processQueuedMessage();
    }
  }

  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    const { state } = this.deps;
    renderQueueIndicator({
      indicatorEl: state.queueIndicatorEl,
      queuedMessage: state.queuedMessage,
      onEdit: () => this.withdrawQueuedMessageToComposer(),
      onDiscard: () => this.clearQueuedMessage(),
    });
  }

  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  withdrawQueuedMessageToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    restoreQueuedMessageToInput({
      message,
      inputEl: this.deps.getInputEl(),
      imageContextManager: this.deps.getImageContextManager(),
      resetInputHeight: () => this.deps.resetInputHeight(),
      mergeWithComposer: options.mergeWithComposer,
    });
  }

  private restorePendingMessagesToInput(): void {
    const { state } = this.deps;
    const queuedMessage = state.queuedMessage
      ? cloneQueuedMessage(state.queuedMessage)
      : null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  private processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateQueueIndicator();

    getActiveWindow(this.deps.getMessagesEl()).setTimeout(
      () => {
        void this.sendMessage({
          content: queuedMessage.content,
          images: queuedMessage.images,
          turnRequestOverride: toQueuedChatTurn(queuedMessage).request,
        });
      },
      0
    );
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.pivi-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    if (isUserMessageStartChunk(chunk)) {
      await this.handleProviderUserMessageStart(chunk);
      return true;
    }
    if (isAssistantMessageStartChunk(chunk)) {
      await this.handleProviderAssistantMessageStart();
      return true;
    }
    return false;
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.updateQueueIndicator();

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = shouldDiscardPendingAssistantPlaceholder(
      this.awaitingProviderAssistantStart,
      previousAssistant,
    );
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (shouldIgnoreAssistantContinuationBoundary(
      this.awaitingProviderAssistantStart,
      previousAssistant,
    )) {
      return;
    }

    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  // ============================================
  // Title Generation
  // ============================================

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    // Restore queued message to input instead of discarding
    this.restorePendingMessagesToInput();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    getActiveWindow(this.deps.getMessagesEl()).requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  async handleApprovalRequest(
    toolName: string,
    _input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    return this.approvals.handleApprovalRequest(toolName, _input, description, approvalOptions);
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    return this.approvals.handleAskUserQuestion(input, signal);
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    return this.approvals.handleExitPlanMode(input, signal);
  }

  dismissPendingApprovalPrompt(): void {
    this.approvals.dismissPendingApprovalPrompt();
  }

  dismissPendingApproval(): void {
    this.approvals.dismissPendingApproval();
  }

  private showPlanApproval(): ReturnType<ComposerApprovals['showPlanApproval']> {
    return this.approvals.showPlanApproval();
  }

}
