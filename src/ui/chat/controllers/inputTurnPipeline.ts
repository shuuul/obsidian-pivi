import type { BrowserSelectionContext } from '@pivi/pivi-agent-core/context/browser';
import type { CanvasSelectionContext } from '@pivi/pivi-agent-core/context/canvas';
import type { EditorSelectionContext } from '@pivi/pivi-agent-core/context/editor';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import { resolveSubagentActivityStatus } from '@pivi/pivi-agent-core/foundation';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';
import { isSubagentToolName } from '@pivi/pivi-agent-core/tools/toolNames';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';
import { captureResponseDurationFooter } from '@/ui/chat/composer/ComposerResponseDuration';
import { queueTurnWhileStreaming } from '@/ui/chat/composer/ComposerStreamingQueue';
import { beginOutgoingTurn } from '@/ui/chat/composer/ComposerTurnLifecycle';

import type { RichChatInput } from '../ui/RichChatInput';
import type { InputControllerDeps } from './InputController';

const logger = new PluginLogger('InputTurnPipeline');

/** Mark still-running spawn/Task cards Cancelled after Esc/Stop (message-model belt-and-suspenders). */
export function terminalizeInterruptedSubagentToolCalls(message: ChatMessage): void {
  const now = Date.now();
  for (const toolCall of message.toolCalls ?? []) {
    if (!isSubagentToolName(toolCall.name)) continue;
    const subagent = toolCall.subagent;
    if (subagent) {
      const status = resolveSubagentActivityStatus(subagent);
      if (status !== 'queued' && status !== 'running' && status !== 'waiting') continue;
      subagent.status = 'error';
      subagent.activityStatus = 'cancelled';
      if (subagent.mode === 'async') {
        subagent.asyncStatus = 'error';
      }
      subagent.result = subagent.result?.trim() || 'Cancelled';
      subagent.completedAt = now;
      toolCall.status = 'error';
      toolCall.activityStatus = 'cancelled';
      toolCall.result = subagent.result;
      toolCall.completedAt = toolCall.completedAt ?? now;
      continue;
    }
    if (toolCall.status !== 'running') continue;
    toolCall.status = 'error';
    toolCall.activityStatus = 'cancelled';
    toolCall.result = toolCall.result ?? 'Cancelled';
    toolCall.completedAt = toolCall.completedAt ?? now;
  }
}

export interface FinalizeOutgoingTurnOptions {
  streamGeneration: number;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  wasInterrupted: boolean;
  wasInvalidated: boolean;
}

export interface InputTurnPipelineHost {
  readonly deps: InputControllerDeps;
  getAgentService(): PiChatService | null;
  triggerTitleGeneration(): Promise<void>;
  getActiveStreamingAssistantMessage(): ChatMessage | null;
  setActiveStreamingAssistantMessage(message: ChatMessage | null): void;
  clearActiveStreamingAssistantMessage(): void;
  seedProviderBoundaryInitialTurn(displayContent: string, images: ChatMessage['images'] | undefined): void;
  resetProviderBoundaryState(): void;
  handleProviderMessageBoundaryChunk(chunk: StreamChunk): boolean;
  updateQueueIndicator(): void;
  processQueuedMessage(): void;
  syncScrollToBottomAfterRenderUpdates(): void;
  sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    onAssistantText?: (accumulatedText: string) => void;
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
    onAssistantText?: (accumulatedText: string) => void;
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    const {
      settings,
      state,
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

    const resolvedContent = await this.resolvePromptContent({
      content,
      inputEl,
      shouldUseInput,
      turnRequestOverride: options?.turnRequestOverride,
    });
    if (resolvedContent === null) return;
    const { displayContent: resolvedDisplayContent, promptContent } = resolvedContent;

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
        getExternalContextSelector: () => this.host.deps.getExternalContextSelector(),
        resetInputHeight: () => this.host.deps.resetInputHeight(),
        updateQueueIndicator: () => this.host.updateQueueIndicator(),
      }, {
        content: resolvedDisplayContent,
        promptContent,
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
      settings,
      state,
      inputEl,
      imageContextManager,
      fileContextManager,
      inlineContextManager,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
      getFileContextManager: () => this.host.deps.getFileContextManager(),
      getExternalContextSelector: () => this.host.deps.getExternalContextSelector(),
      getSubagentManager: () => this.host.deps.getSubagentManager(),
      generateId: () => this.host.deps.generateId(),
      resetInputHeight: () => this.host.deps.resetInputHeight(),
    }, {
      content: resolvedDisplayContent,
      promptContent,
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
      logger.error('Title generation setup failed', error);
    }

    state.addMessage(assistantMsg);
    this.host.setActiveStreamingAssistantMessage(assistantMsg);
    this.host.seedProviderBoundaryInitialTurn(displayContent, imagesForMessage);

    state.responseStartTime = performance.now();
    streamController.showThinkingIndicator(isCompact ? 'Compacting...' : undefined);

    let wasInterrupted = false;
    let wasInvalidated = false;

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
        onAssistantText: options?.onAssistantText,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const content = `\n\n**Error:** ${errorMsg}`;
      assistantMsg.content += content;
      assistantMsg.contentBlocks = [
        ...(assistantMsg.contentBlocks ?? []),
        { type: 'text', content },
      ];
      state.notifyMessageChanged(assistantMsg);
    } finally {
      await this.finalizeOutgoingTurn({
        streamGeneration,
        userMsg,
        assistantMsg,
        wasInterrupted,
        wasInvalidated,
      });
    }
  }

  private async resolvePromptContent(options: {
    content: string;
    inputEl: RichChatInput;
    shouldUseInput: boolean;
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<{ displayContent: string; promptContent: string } | null> {
    const resolver = this.host.deps.resolveWorkspaceCommand;
    if (options.turnRequestOverride || !resolver) {
      return { displayContent: options.content, promptContent: options.content };
    }

    try {
      const resolved = await resolver(options.content);
      if (options.shouldUseInput && options.inputEl.value.trim() !== options.content) return null;
      return resolved;
    } catch (error) {
      logger.error('Failed to resolve custom template command', error);
      new Notice(t('chat.errors.templateVarsFailed'));
      return null;
    }
  }

  private async getReadyAgentService(): Promise<PiChatService | null> {
    const { state, streamController } = this.host.deps;

    if (this.host.deps.ensureServiceInitialized) {
      const ready = await this.host.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice(t('chat.errors.initAgentFailed'));
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.host.clearActiveStreamingAssistantMessage();
        this.host.resetProviderBoundaryState();
        return null;
      }
    }

    const agentService = this.host.getAgentService();
    if (!agentService) {
      new Notice(t('chat.errors.agentUnavailable'));
      streamController.hideThinkingIndicator();
      state.isStreaming = false;
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
    onAssistantText?: (accumulatedText: string) => void;
  }): Promise<{ wasInterrupted: boolean; wasInvalidated: boolean }> {
    const { state, streamController } = this.host.deps;
    const preparedTurn = {
      ...options.agentService.prepareTurn(options.turnRequest),
      displayContent: options.userMsg.displayContent ?? options.userMsg.content,
    };
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

      if (this.host.handleProviderMessageBoundaryChunk(chunk)) {
        continue;
      }

      const activeAssistantMessage = this.host.getActiveStreamingAssistantMessage()
        ?? options.assistantMsg;
      await streamController.handleStreamChunk(chunk, activeAssistantMessage);
      if (chunk.type === 'text' && options.onAssistantText) {
        const accumulatedText = activeAssistantMessage.contentBlocks?.length
          ? activeAssistantMessage.contentBlocks.reduce(
              (text, block) => block.type === 'text' ? text + block.content : text,
              '',
            )
          : activeAssistantMessage.content;
        options.onAssistantText(accumulatedText);
      }
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
    }


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

    if (didCancelThisTurn) {
      // Abort kills workers, but presentation state lives on the assistant message.
      // Terminalize before resetStreamingState clears manager bookkeeping maps.
      this.host.deps.getSubagentManager().cancelAllActive();
      terminalizeInterruptedSubagentToolCalls(options.finalAssistantMsg);
      const interruption = '\n\n<span class="pivi-interrupted">Interrupted</span> <span class="pivi-interrupted-hint">· What should Pivi do instead?</span>';
      options.finalAssistantMsg.content += interruption;
      options.finalAssistantMsg.contentBlocks = [
        ...(options.finalAssistantMsg.contentBlocks ?? []),
        { type: 'text', content: interruption },
      ];
      state.notifyMessageChanged(options.finalAssistantMsg);
    }
    streamController.hideThinkingIndicator();
    state.isStreaming = false;
    state.cancelRequested = false;
    captureResponseDurationFooter({
      message: options.finalAssistantMsg,
      responseStartTime: state.responseStartTime,
      didCancelThisTurn,
    });
    state.notifyMessageChanged(options.finalAssistantMsg);
    state.completeProjectionRun();

    this.host.deps.getSubagentManager().resetStreamingState();

    this.clearCompletedTodos();
    this.host.syncScrollToBottomAfterRenderUpdates();
    await this.saveAndDispatchTurnFollowUp(options);
  }

  private clearCompletedTodos(): void {
    const { state } = this.host.deps;
    if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
      state.currentTodos = null;
    }
  }

  private async saveAndDispatchTurnFollowUp(
    options: FinalizeOutgoingTurnOptions & { finalAssistantMsg: ChatMessage },
  ): Promise<void> {
    const { openSessionController } = this.host.deps;

    await openSessionController.save(true);

    this.host.processQueuedMessage();
  }
}
