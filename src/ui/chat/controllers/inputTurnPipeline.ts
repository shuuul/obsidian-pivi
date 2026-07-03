import type { BrowserSelectionContext } from '@pivi/pivi-agent-core/context/browser';
import type { CanvasSelectionContext } from '@pivi/pivi-agent-core/context/canvas';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';
import { TOOL_EXIT_PLAN_MODE } from '@pivi/pivi-agent-core/tools/toolNames';
import { Notice } from 'obsidian';

import type { PlanApprovalResult } from '@/ui/chat/composer/ComposerApprovals';
import { resolvePlanCompletionFollowUp } from '@/ui/chat/composer/ComposerPlanFollowUp';
import { captureResponseDurationFooter } from '@/ui/chat/composer/ComposerResponseDuration';
import { queueTurnWhileStreaming } from '@/ui/chat/composer/ComposerStreamingQueue';
import { beginOutgoingTurn } from '@/ui/chat/composer/ComposerTurnLifecycle';

import type { EditorSelectionContext } from '../../shared/utils/editor';
import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { InputControllerDeps } from './InputController';

export interface FinalizeOutgoingTurnOptions {
  streamGeneration: number;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  wasInterrupted: boolean;
  wasInvalidated: boolean;
  planCompleted: boolean;
}

export interface InputTurnPipelineHost {
  readonly deps: InputControllerDeps;
  getAgentService(): PiChatService | null;
  triggerTitleGeneration(): Promise<void>;
  getActiveStreamingAssistantMessage(): ChatMessage | null;
  setActiveStreamingAssistantMessage(message: ChatMessage | null): void;
  clearActiveStreamingAssistantMessage(): void;
  activateStreamingAssistantMessage(message: ChatMessage): void;
  seedProviderBoundaryInitialTurn(displayContent: string, images: ChatMessage['images'] | undefined): void;
  resetProviderBoundaryState(): void;
  handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean>;
  updateQueueIndicator(): void;
  processQueuedMessage(): void;
  syncScrollToBottomAfterRenderUpdates(): void;
  showPlanApproval(): Promise<PlanApprovalResult>;
  sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void>;
}

export class InputTurnPipeline {
  private readonly host: InputTurnPipelineHost;

  constructor(host: InputTurnPipelineHost) {
    this.host = host;
  }

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
    } = this.host.deps;

    if (state.isCreatingSession || state.isSwitchingSession) return;

    const inputEl = this.host.deps.getInputEl();
    const imageContextManager = this.host.deps.getImageContextManager();
    const fileContextManager = this.host.deps.getFileContextManager();
    const inlineContextManager = this.host.deps.getInlineContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const content = (contentOverride ?? inputEl.value).trim();
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages) return;

    if (state.isStreaming) {
      queueTurnWhileStreaming({
        state,
        inputEl,
        imageContextManager,
        inlineContextManager,
        selectionController,
        browserSelectionController,
        canvasSelectionController,
        getFileContextManager: () => this.host.deps.getFileContextManager(),
        getMcpServerSelector: () => this.host.deps.getMcpServerSelector(),
        getExternalContextSelector: () => this.host.deps.getExternalContextSelector(),
        resetInputHeight: () => this.host.deps.resetInputHeight(),
        updateQueueIndicator: () => this.host.updateQueueIndicator(),
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
      getWelcomeEl: () => this.host.deps.getWelcomeEl(),
      getFileContextManager: () => this.host.deps.getFileContextManager(),
      getMcpServerSelector: () => this.host.deps.getMcpServerSelector(),
      getExternalContextSelector: () => this.host.deps.getExternalContextSelector(),
      getSubagentManager: () => this.host.deps.getSubagentManager(),
      generateId: () => this.host.deps.generateId(),
      resetInputHeight: () => this.host.deps.resetInputHeight(),
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
      await this.host.triggerTitleGeneration();
    } catch (error) {
      console.error('Pivi: title generation setup failed', error);
    }

    state.addMessage(assistantMsg);
    this.host.setActiveStreamingAssistantMessage(assistantMsg);
    this.host.activateStreamingAssistantMessage(assistantMsg);
    this.host.seedProviderBoundaryInitialTurn(displayContent, imagesForMessage);

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
    const { state, streamController } = this.host.deps;

    if (this.host.deps.ensureServiceInitialized) {
      const ready = await this.host.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice('Failed to initialize agent service. Please try again.');
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.host.clearActiveStreamingAssistantMessage();
        this.host.resetProviderBoundaryState();
        return null;
      }
    }

    const agentService = this.host.getAgentService();
    if (!agentService) {
      new Notice('Agent service not available. Please reload the plugin.');
      this.host.clearActiveStreamingAssistantMessage();
      this.host.resetProviderBoundaryState();
      return null;
    }

    return agentService;
  }

  async runOutgoingTurnQuery(options: {
    agentService: PiChatService;
    turnRequest: ChatTurnRequest;
    userMsg: ChatMessage;
    assistantMsg: ChatMessage;
    streamGeneration: number;
  }): Promise<{ wasInterrupted: boolean; wasInvalidated: boolean }> {
    const { state, streamController } = this.host.deps;
    const preparedTurn = options.agentService.prepareTurn(options.turnRequest);
    options.userMsg.content = preparedTurn.persistedContent;
    options.userMsg.currentNote = preparedTurn.isCompact
      ? undefined
      : preparedTurn.request.currentNotePath;

    const previousMessages = state.messages.slice(0, -2);
    for await (const chunk of options.agentService.query(preparedTurn, previousMessages)) {
      if (state.streamGeneration !== options.streamGeneration) {
        return { wasInterrupted: false, wasInvalidated: true };
      }
      if (state.cancelRequested) {
        return { wasInterrupted: true, wasInvalidated: false };
      }

      if (await this.host.handleProviderMessageBoundaryChunk(chunk)) {
        continue;
      }

      await streamController.handleStreamChunk(
        chunk,
        this.host.getActiveStreamingAssistantMessage() ?? options.assistantMsg,
      );
    }

    return { wasInterrupted: false, wasInvalidated: false };
  }

  private async finalizeOutgoingTurn(options: FinalizeOutgoingTurnOptions): Promise<void> {
    const { state } = this.host.deps;
    const agentService = this.host.getAgentService();
    const finalAssistantMsg = this.host.getActiveStreamingAssistantMessage() ?? options.assistantMsg;

    if (agentService) {
      const turnMetadata = agentService.consumeTurnMetadata();
      options.userMsg.userMessageId = turnMetadata.userMessageId ?? options.userMsg.userMessageId;
      options.userMsg.parentEntryId = turnMetadata.userParentEntryId !== undefined
        ? turnMetadata.userParentEntryId
        : options.userMsg.parentEntryId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      options.planCompleted = options.planCompleted || turnMetadata.planCompleted === true;
    }

    state.clearFlavorTimerInterval();

    if (!options.wasInvalidated && state.streamGeneration === options.streamGeneration) {
      await this.finalizeCurrentOutgoingTurn({
        ...options,
        finalAssistantMsg,
      });
    }

    if (options.wasInvalidated) {
      this.host.updateQueueIndicator();
    }

    this.host.clearActiveStreamingAssistantMessage();
    this.host.resetProviderBoundaryState();
  }

  private async finalizeCurrentOutgoingTurn(
    options: FinalizeOutgoingTurnOptions & { finalAssistantMsg: ChatMessage },
  ): Promise<void> {
    const { state, streamController } = this.host.deps;
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
    this.host.deps.getSubagentManager().resetStreamingState();

    this.clearCompletedTodos();
    this.host.syncScrollToBottomAfterRenderUpdates();
    this.markApprovedNewSessionPlanToolResult(options.finalAssistantMsg);
    await this.saveAndDispatchTurnFollowUp(options, didCancelThisTurn);
  }

  private clearCompletedTodos(): void {
    const { state } = this.host.deps;
    if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
      state.currentTodos = null;
    }
  }

  private markApprovedNewSessionPlanToolResult(finalAssistantMsg: ChatMessage): void {
    const { state } = this.host.deps;
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
    const { state, renderer, openSessionController } = this.host.deps;
    const planFollowUp = await resolvePlanCompletionFollowUp({
      planCompleted: options.planCompleted,
      didCancelThisTurn,
      streamGeneration: options.streamGeneration,
      getCurrentStreamGeneration: () => state.streamGeneration,
      showPlanApproval: () => this.host.showPlanApproval(),
      restorePrePlanPermissionModeIfNeeded: () => {
        this.host.deps.restorePrePlanPermissionModeIfNeeded?.();
      },
      setInputValue: (value) => {
        this.host.deps.getInputEl().value = value;
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
    if (planFollowUp.autoSendContent) {
      this.host.deps.getInputEl().value = planFollowUp.autoSendContent;
      this.host.sendMessage().catch(() => {});
      return;
    }

    const planContent = this.host.deps.state.pendingNewSessionPlan;
    if (planContent) {
      this.host.deps.state.pendingNewSessionPlan = null;
      await this.host.deps.openSessionController.createNew();
      this.host.deps.getInputEl().value = planContent;
      this.host.sendMessage().catch(() => {});
      return;
    }

    if (planFollowUp.shouldProcessQueuedMessage) {
      this.host.processQueuedMessage();
    }
  }
}