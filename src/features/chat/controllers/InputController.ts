import { Notice } from 'obsidian';

import { AgentServices } from '../../../core/agent/AgentServices';
import {
  type RuntimeCapabilities,
  type TitleGenerationService,
} from '../../../core/agent/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallbackOptions,
  ApprovalDecisionOption,
  ChatTurnRequest,
} from '../../../core/runtime/types';
import { TOOL_EXIT_PLAN_MODE } from '../../../core/tools/toolNames';
import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '../../../core/types';
import type PiviPlugin from '../../../main';
import { getActiveWindow } from '../../../shared/dom';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { resolveUserMessageDisplayText } from '../../../utils/context';
import type { EditorSelectionContext } from '../../../utils/editor';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePlanApproval,type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { setToolIcon, updateToolCallResult } from '../rendering/ToolCallRenderer';
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
import { resolvePlanCompletionFollowUp } from './inputPlanCompletion';
import {
  isAssistantMessageStartChunk,
  isUserMessageStartChunk,
  shouldDiscardPendingAssistantPlaceholder,
  shouldIgnoreAssistantContinuationBoundary,
} from './inputProviderBoundary';
import {
  cloneQueuedMessage,
  mergePendingQueuedMessages,
  mergeQueuedMessages,
  toQueuedChatTurn,
} from './inputQueue';
import { renderQueueIndicator } from './inputQueueIndicator';
import { restoreQueuedMessageToInput } from './inputQueueRestore';
import { captureResponseDurationFooter } from './inputResponseDuration';
import { isResumeCheckpointStillNeeded } from './inputResumeCheckpoint';
import { queueTurnWhileStreaming } from './inputStreamingQueue';
import { beginOutgoingTurn } from './inputTurnLifecycle';
import type { SelectionController } from './SelectionController';
import type { SessionController } from './SessionController';
import type { StreamController } from './StreamController';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  'Deny': 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    label,
    value: label,
    decision,
  }));

interface FinalizeOutgoingTurnOptions {
  streamGeneration: number;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  wasInterrupted: boolean;
  wasInvalidated: boolean;
  didEnqueueToSdk: boolean;
  planCompleted: boolean;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  getAgentService?: () => ChatRuntime | null;
  getSubagentManager: () => SubagentManager;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openSession?: (openSessionId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
}

export class InputController {
  private deps: InputControllerDeps;
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private inputContainerHideDepth = 0;
  private steerInFlight = false;
  private pendingSteerMessage: QueuedMessage | null = null;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }> = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  private getActiveCapabilities(): RuntimeCapabilities {
    return this.getAgentService()?.getCapabilities() ?? AgentServices.getCapabilities();
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
      await this.triggerTitleGeneration();
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
    const didEnqueueToSdk = false;
    const planCompleted = false;

    const agentService = await this.getReadyAgentService();
    if (!agentService) {
      return;
    }

    await this.restoreResumeCheckpointForSend(agentService);

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
        didEnqueueToSdk,
        planCompleted,
      });
    }
  }

  private async getReadyAgentService(): Promise<ChatRuntime | null> {
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

  private async restoreResumeCheckpointForSend(agentService: ChatRuntime): Promise<void> {
    const { plugin, state } = this.deps;
    // Restore pendingResumeAt from persisted session state (survives plugin reload)
    const openSessionIdForSend = state.currentOpenSessionId;
    if (!openSessionIdForSend) {
      return;
    }

    const conv = plugin.getOpenSessionSync(openSessionIdForSend);
    if (!conv?.resumeAtMessageId) {
      return;
    }

    if (isResumeCheckpointStillNeeded(conv.resumeAtMessageId, state.messages.slice(0, -2))) {
      agentService.setResumeCheckpoint(conv.resumeAtMessageId);
      return;
    }

    try {
      await plugin.updateSession(openSessionIdForSend, { resumeAtMessageId: undefined });
    } catch {
      // Best-effort — don't block send
    }
  }

  private async runOutgoingTurnQuery(options: {
    agentService: ChatRuntime;
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
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      options.didEnqueueToSdk = options.didEnqueueToSdk || turnMetadata.wasSent === true;
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
      this.clearPendingSteerState();
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
    this.restorePendingSteerMessageToQueue();

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
    options: FinalizeOutgoingTurnOptions,
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

    // Only clear resumeAtMessageId if enqueue succeeded; preserve checkpoint on failure for retry
    const saveExtras = options.didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
    await openSessionController.save(true, saveExtras);

    const userMsgIndex = state.messages.indexOf(options.userMsg);
    renderer.refreshActionButtons(options.userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);

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
      pendingSteerMessage: this.pendingSteerMessage,
      canSteer: this.canSteerQueuedMessage(),
      steerInFlight: this.steerInFlight,
      onSteer: () => { void this.steerQueuedMessage(); },
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
    const combinedMessage = mergePendingQueuedMessages(
      this.pendingSteerMessage,
      state.queuedMessage,
    );
    this.restoreMessageToInput(combinedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.clearPendingSteerState();
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

  private canSteerQueuedMessage(): boolean {
    const agentService = this.getAgentService();
    return this.deps.state.isStreaming
      && this.getActiveCapabilities().supportsTurnSteer === true
      && typeof agentService?.steer === 'function';
  }

  private clearPendingSteerState(): void {
    this.pendingSteerMessage = null;
    this.steerInFlight = false;
  }

  private restorePendingSteerMessageToQueue(): void {
    if (!this.pendingSteerMessage) {
      return;
    }

    const { state } = this.deps;
    const pendingSteerMessage = cloneQueuedMessage(this.pendingSteerMessage);
    this.clearPendingSteerState();
    state.queuedMessage = state.queuedMessage
      ? mergeQueuedMessages(pendingSteerMessage, state.queuedMessage)
      : pendingSteerMessage;
    this.updateQueueIndicator();
  }

  private async steerQueuedMessage(): Promise<void> {
    if (this.steerInFlight) {
      return;
    }

    const { state } = this.deps;
    const agentService = this.getAgentService();
    if (!state.queuedMessage || !this.canSteerQueuedMessage() || !agentService?.steer) {
      return;
    }

    const queuedMessage = cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.updateQueueIndicator();

    try {
      const { displayContent, request } = toQueuedChatTurn(queuedMessage);

      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.steer(preparedTurn);
      if (state.cancelRequested || !this.pendingSteerMessage) {
        return;
      }
      if (!accepted) {
        this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
        return;
      }

      this.deps.getFileContextManager()?.markCurrentNoteSent();

      this.pendingProviderUserMessages.push({
        displayContent,
        persistedContent: preparedTurn.persistedContent,
        currentNote: preparedTurn.isCompact
          ? undefined
          : preparedTurn.request.currentNotePath,
        images: request.images,
      });
    } catch {
      this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      new Notice('Failed to steer the queued message. It is still available.');
    }
  }

  private restoreQueuedMessageAfterSteerFailure(
    message: QueuedMessage,
  ): void {
    const { state } = this.deps;
    this.clearPendingSteerState();
    if (state.cancelRequested) {
      this.updateQueueIndicator();
      return;
    }

    if (state.isStreaming) {
      state.queuedMessage = state.queuedMessage
        ? mergeQueuedMessages(message, state.queuedMessage)
        : message;
      this.updateQueueIndicator();
      return;
    }

    this.restoreMessageToInput(message, { mergeWithComposer: true });
    this.updateQueueIndicator();
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

    this.clearPendingSteerState();
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
      this.pendingProviderUserMessages.length,
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

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, openSessionController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentOpenSessionId) {
      const agentService = this.getAgentService();
      let sessionFile: string | undefined;
      let leafId: string | null | undefined;
      if (agentService && this.deps.ensureServiceInitialized) {
        try {
          await this.deps.ensureServiceInitialized();
          const built = agentService.buildSessionUpdates({
            openSession: null,
            sessionInvalidated: false,
          });
          sessionFile = built.updates.sessionFile;
          leafId = built.updates.leafId ?? null;
        } catch {
          // Fall back to a fresh JSONL session below.
        }
      }
      const openSession = await plugin.createOpenSession({
        sessionId: agentService?.getSessionId() ?? undefined,
        sessionFile,
        leafId,
      });
      state.currentOpenSessionId = openSession.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = resolveUserMessageDisplayText(firstUserMsg);

    // Set immediate fallback title
    const fallbackTitle = openSessionController.generateFallbackTitle(userContent);
    await plugin.renameSession(state.currentOpenSessionId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateSession(state.currentOpenSessionId, { titleGenerationStatus: 'pending' });
    openSessionController.updateHistoryDropdown();

    const convId = state.currentOpenSessionId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      async (openSessionId, result) => {
        // Check if openSession still exists and user hasn't manually renamed
        const currentConv = await plugin.getOpenSessionById(openSessionId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameSession(openSessionId, result.title);
          await plugin.updateSession(openSessionId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateSession(openSessionId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateSession(openSessionId, { titleGenerationStatus: undefined });
        }
        openSessionController.updateHistoryDropdown();
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }

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
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    // Build header element, then detach — InlineAskUserQuestion will re-attach it
    const headerEl = parentEl.createDiv({ cls: 'pivi-ask-approval-info' });
    headerEl.remove();

    const toolEl = headerEl.createDiv({ cls: 'pivi-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'pivi-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'pivi-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({ text: approvalOptions.decisionReason, cls: 'pivi-ask-approval-reason' });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({ text: approvalOptions.blockedPath, cls: 'pivi-ask-approval-blocked-path' });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({ text: `Agent: ${approvalOptions.agentID}`, cls: 'pivi-ask-approval-agent' });
    }

    headerEl.createDiv({ text: description, cls: 'pivi-ask-approval-desc' });

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });
    const input = {
      questions: [{
        question: 'Allow this action?',
        options: questionOptions,
        isOther: false,
        isSecret: false,
      }],
    };

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingApprovalInline = inline; },
      undefined,
      { title: 'Permission required', headerEl, showCustomInput: false, immediateSelect: true },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(`Unexpected approval selection: "${String(selectedValue)}"`);
      return 'cancel';
    }

    const decision = optionDecisionMap.get(selectedValue);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: selectedValue,
    };
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingAskInline = inline; },
      signal,
    );
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          setPending(null);
          this.restoreInputContainer(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (err) {
        setPending(null);
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    const { state, streamController } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderer.renderContent(el, markdown);

    const planPathPrefix = this.getActiveCapabilities().planPathPrefix;

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          this.restoreInputContainer(inputContainerEl);
          resolve(decision);
        },
        signal,
        renderContent,
        planPathPrefix,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval(true);
    this.resetInputContainerVisibility();
  }

  private showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      return Promise.resolve({ decision: null, invalidated: false });
    }

    this.hideInputContainer(inputContainerEl);
    this.pendingPlanApprovalInvalidated = false;

    return new Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>((resolve, reject) => {
      const inline = new InlinePlanApproval(
        parentEl,
        (decision: PlanApprovalDecision | null) => {
          const invalidated = this.pendingPlanApprovalInvalidated;
          this.pendingPlanApprovalInvalidated = false;
          this.pendingPlanApproval = null;
          this.restoreInputContainer(inputContainerEl);
          resolve({ decision, invalidated });
        },
      );
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) {
      return;
    }

    if (invalidated) {
      this.pendingPlanApprovalInvalidated = true;
    }
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('pivi-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) {
      inputContainerEl.removeClass('pivi-hidden');
    }
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth > 0) {
      this.inputContainerHideDepth = 0;
      this.deps.getInputContainerEl().removeClass('pivi-hidden');
    }
  }

}
