import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';

import type { InputControllerDeps } from './InputController';
import {
  isAssistantMessageStartChunk,
  isUserMessageStartChunk,
  shouldDiscardPendingAssistantPlaceholder,
  shouldIgnoreAssistantContinuationBoundary,
} from './inputProviderBoundary';

export type PendingProviderUserMessage = {
  displayContent: string;
  persistedContent?: string;
  currentNote?: string;
  images?: ChatMessage['images'];
};

export interface InputProviderBoundaryHost {
  readonly deps: InputControllerDeps;
  getActiveStreamingAssistantMessage(): ChatMessage | null;
  setActiveStreamingAssistantMessage(message: ChatMessage | null): void;
  discardStreamingAssistantMessage(messageId: string): void;
  updateQueueIndicator(): void;
}

export class InputProviderBoundaryHandler {
  private readonly host: InputProviderBoundaryHost;
  private pendingProviderUserMessages: PendingProviderUserMessage[] = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;

  constructor(host: InputProviderBoundaryHost) {
    this.host = host;
  }

  reset(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  seedInitialTurn(displayContent: string, images: ChatMessage['images'] | undefined): void {
    this.pendingProviderUserMessages = [{ displayContent, images }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;
  }

  handleProviderMessageBoundaryChunk(chunk: StreamChunk): boolean {
    if (isUserMessageStartChunk(chunk)) {
      this.handleProviderUserMessageStart(chunk);
      return true;
    }
    if (isAssistantMessageStartChunk(chunk)) {
      this.handleProviderAssistantMessageStart();
      return true;
    }
    return false;
  }

  private handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): void {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.host.updateQueueIndicator();

    const previousAssistant = this.host.getActiveStreamingAssistantMessage();
    const shouldDiscardPlaceholder = shouldDiscardPendingAssistantPlaceholder(
      this.awaitingProviderAssistantStart,
      previousAssistant,
    );
    if (previousAssistant && shouldDiscardPlaceholder) {
      this.host.discardStreamingAssistantMessage(previousAssistant.id);
    }
    this.host.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.host.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
      };
      this.host.deps.state.addMessage(userMessage);
    }

    const assistantMessage: ChatMessage = {
      id: this.host.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.host.deps.state.addMessage(assistantMessage);
    this.host.setActiveStreamingAssistantMessage(assistantMessage);
    this.host.deps.streamController.showThinkingIndicator();
    this.host.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private handleProviderAssistantMessageStart(): void {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.host.getActiveStreamingAssistantMessage();
    if (shouldIgnoreAssistantContinuationBoundary(
      this.awaitingProviderAssistantStart,
      previousAssistant,
    )) {
      return;
    }


    const assistantMessage: ChatMessage = {
      id: this.host.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.host.deps.state.addMessage(assistantMessage);
    this.host.setActiveStreamingAssistantMessage(assistantMessage);
    this.host.deps.streamController.showThinkingIndicator();
  }
}