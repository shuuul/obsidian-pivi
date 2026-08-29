import type { BrowserSelectionContext } from '@pivi/agent/context/browser';
import type { CanvasSelectionContext } from '@pivi/agent/context/canvas';
import type { EditorSelectionContext } from '@pivi/agent/context/editor';
import type { CapabilityApprovalRequest, CapabilityApprovalResult } from '@pivi/agent/ports';
import type { ChatMessage, StreamChunk } from '@pivi/agent/runtime';
import type { TitleGenerationService } from '@pivi/agent/runtime/auxTypes';
import type {
  ChatPorts,
  ChatSettingsPort,
} from '@pivi/agent/runtime/chatPorts';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';
import type { ChatTurnRequest } from '@pivi/agent/runtime/types';
import type { PiviManagementApprovalDecision, PiviManagementApprovalRequest } from '@pivi/agent/tools/piviManagement';

import type { PiviChatHost } from '@/app/hostContracts';
import { ComposerInlinePrompts } from '@/ui/chat/composer/ComposerInlinePrompts';

import type { FileContextManager } from '../input/FileContext';
import type { ImageContextManager } from '../input/ImageContext';
import type { InlineContextManager } from '../input/InlineContext';
import type { RichChatInput } from '../input/RichChatInput';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { AddExternalContextResult } from '../toolbar/ExternalContextControl';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import { InputProviderBoundaryHandler } from './inputProviderBoundaries';
import { InputQueueRestoreCoordinator } from './inputQueueRestore';
import { InputTurnPipeline } from './inputTurnPipeline';
import type { SelectionController } from './SelectionController';
import type { SessionController } from './SessionController';
import type { StreamController } from './StreamController';
import { TitleGenerationCoordinator } from './TitleGenerationCoordinator';

export interface InputControllerDeps {
  plugin: PiviChatHost;
  settings: ChatSettingsPort;
  sessions: ChatPorts['sessions'];
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  openSessionController: SessionController;
  getInputEl: () => RichChatInput;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getInlineContextManager: () => InlineContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;

  getTitleGenerationService: () => TitleGenerationService | null;
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
  onTitleChanged?: (title: string) => void;
  getDraftCustomTitle?: () => string | null;
  clearDraftCustomTitle?: () => void;
  resolveWorkspaceCommand?: (content: string) => Promise<{
    displayContent: string;
    promptContent: string;
  } | null>;
}

export class InputController {
  private readonly controllerDeps: InputControllerDeps;
  private inlinePrompts: ComposerInlinePrompts;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private titleGenerationCoordinator: TitleGenerationCoordinator;
  private readonly providerBoundaries: InputProviderBoundaryHandler;
  private readonly queueRestore: InputQueueRestoreCoordinator;
  private readonly turnPipeline: InputTurnPipeline;

  constructor(deps: InputControllerDeps) {
    this.controllerDeps = deps;
    this.inlinePrompts = new ComposerInlinePrompts({
      state: deps.state,
      renderer: deps.renderer,
      streamController: deps.streamController,
      getInputContainerEl: () => deps.getInputContainerEl(),
    });
    this.titleGenerationCoordinator = new TitleGenerationCoordinator({
      settings: deps.settings,
      sessions: deps.sessions,
      state: deps.state,
      openSessionController: deps.openSessionController,
      getTitleGenerationService: deps.getTitleGenerationService,
      getAgentService: () => this.getAgentService(),
      ensureServiceInitialized: deps.ensureServiceInitialized,
      onTitleChanged: deps.onTitleChanged,
      getDraftCustomTitle: deps.getDraftCustomTitle,
      clearDraftCustomTitle: deps.clearDraftCustomTitle,
    });
    this.providerBoundaries = new InputProviderBoundaryHandler(this);
    this.queueRestore = new InputQueueRestoreCoordinator(this);
    this.turnPipeline = new InputTurnPipeline(this);
  }

  get deps(): InputControllerDeps {
    return this.controllerDeps;
  }

  getAgentService(): PiChatService | null {
    return this.controllerDeps.getAgentService?.() ?? null;
  }

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    onSubmissionAccepted?: () => void;
    onAssistantText?: (accumulatedText: string) => void;
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    return this.turnPipeline.sendMessage(options);
  }

  updateQueueIndicator(): void {
    this.queueRestore.updateQueueIndicator();
  }

  clearQueuedMessages(): void {
    this.queueRestore.clearQueuedMessages();
  }

  discardQueuedMessage(id: string): void {
    this.queueRestore.discardQueuedMessage(id);
  }

  reorderQueuedMessages(ids: readonly string[]): boolean {
    return this.queueRestore.reorderQueuedMessages(ids);
  }

  withdrawQueuedMessageToComposer(id: string): void {
    this.queueRestore.withdrawQueuedMessageToComposer(id);
  }

  steerQueuedMessage(id: string): void {
    this.queueRestore.steerQueuedMessage(id);
  }

  enqueueProviderUserTurn(message: Parameters<InputProviderBoundaryHandler['enqueueUserTurn']>[0]): void {
    this.providerBoundaries.enqueueUserTurn(message);
  }

  cancelStreaming(): void {
    const { state, streamController } = this.controllerDeps;
    this.inlinePrompts.dismissPendingInlinePrompts();
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    this.queueRestore.restorePendingMessagesToInput();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
    state.flushProjection();
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    return this.inlinePrompts.handleAskUserQuestion(input, signal);
  }

  async handleCapabilityApproval(
    request: CapabilityApprovalRequest,
  ): Promise<CapabilityApprovalResult> {
    return this.inlinePrompts.handleCapabilityApproval(request);
  }

  handlePiviManagementApproval(
    request: PiviManagementApprovalRequest,
    signal?: AbortSignal,
  ): Promise<PiviManagementApprovalDecision> {
    return this.inlinePrompts.handlePiviManagementApproval(request, signal);
  }

  dismissPendingInlinePrompts(): void {
    this.inlinePrompts.dismissPendingInlinePrompts();
  }

  getActiveStreamingAssistantMessage(): ChatMessage | null {
    return this.activeStreamingAssistantMessage;
  }

  setActiveStreamingAssistantMessage(message: ChatMessage | null): void {
    this.activeStreamingAssistantMessage = message;
  }

  clearActiveStreamingAssistantMessage(): void {
    this.activeStreamingAssistantMessage = null;
  }

  discardStreamingAssistantMessage(messageId: string): void {
    const { state } = this.controllerDeps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    state.resetCurrentAssistantStream();
  }

  seedProviderBoundaryInitialTurn(displayContent: string, images: ChatMessage['images'] | undefined): void {
    this.providerBoundaries.seedInitialTurn(displayContent, images);
  }

  resetProviderBoundaryState(): void {
    this.providerBoundaries.reset();
  }

  handleProviderMessageBoundaryChunk(chunk: StreamChunk): boolean {
    return this.providerBoundaries.handleProviderMessageBoundaryChunk(chunk);
  }

  processQueuedMessage(): void {
    this.queueRestore.processQueuedMessage();
  }

  async triggerTitleGeneration(): Promise<void> {
    await this.titleGenerationCoordinator.triggerTitleGeneration();
  }

  syncScrollToBottomAfterRenderUpdates(): void {
    this.controllerDeps.state.flushProjection();
  }
}
