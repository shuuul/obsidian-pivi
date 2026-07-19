import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';

import {
  cloneQueuedMessage,
  toQueuedChatTurn,
} from '@/ui/chat/composer/ComposerQueue';
import { restoreQueuedMessageToInput } from '@/ui/chat/composer/ComposerQueueRestore';
import { getActiveWindow } from '@/ui/shared/dom';

import type { QueuedMessage } from '../state/types';
import type { InputControllerDeps } from './InputController';

export interface InputQueueRestoreHost {
  readonly deps: InputControllerDeps;
  sendMessage(options?: {
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void>;
  enqueueProviderUserTurn(message: {
    displayContent: string;
    persistedContent: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }): void;
}

export class InputQueueRestoreCoordinator {
  private readonly host: InputQueueRestoreHost;

  constructor(host: InputQueueRestoreHost) {
    this.host = host;
  }

  /** Queue state publishes synchronously to the active React surface. */
  updateQueueIndicator(): void {}


  clearQueuedMessages(): void {
    this.host.deps.state.queuedMessages = [];
  }

  discardQueuedMessage(id: string): void {
    const { state } = this.host.deps;
    state.queuedMessages = state.queuedMessages.filter(message => message.id !== id);
  }

  reorderQueuedMessages(ids: readonly string[]): void {
    const { state } = this.host.deps;
    if (
      ids.length !== state.queuedMessages.length
      || new Set(ids).size !== ids.length
    ) return;
    const messagesById = new Map(state.queuedMessages.map(message => [message.id, message]));
    const reordered: QueuedMessage[] = [];
    for (const id of ids) {
      const message = messagesById.get(id);
      if (!message) return;
      reordered.push(message);
    }
    state.queuedMessages = reordered;
  }

  withdrawQueuedMessageToComposer(id: string): void {
    const { state } = this.host.deps;
    const queuedMessage = state.queuedMessages.find(message => message.id === id);
    if (!queuedMessage) return;

    state.queuedMessages = state.queuedMessages.filter(message => message.id !== id);
    this.restoreMessageToInput(cloneQueuedMessage(queuedMessage), { mergeWithComposer: true });
  }

  steerQueuedMessage(id: string): void {
    const { state } = this.host.deps;
    const agentService = this.host.deps.getAgentService?.();
    const queuedMessage = state.queuedMessages.find(message => message.id === id);
    if (!queuedMessage || !state.isStreaming || !agentService?.steer) return;

    const queuedMessageSnapshot = cloneQueuedMessage(queuedMessage);
    const queuedTurn = toQueuedChatTurn(queuedMessageSnapshot);
    const externalContextPaths = this.host.deps.getExternalContextSelector()
      ?.getExternalContexts() ?? [];
    queuedTurn.request.externalContextPaths = externalContextPaths.length > 0
      ? [...externalContextPaths]
      : undefined;
    queuedTurn.request.enabledMcpServers = undefined;
    const preparedTurn = agentService.prepareTurn(queuedTurn.request);
    if (!agentService.steer({
      ...preparedTurn,
      displayContent: queuedTurn.displayContent,
    })) return;

    state.queuedMessages = state.queuedMessages.filter(message => message.id !== id);
    this.host.enqueueProviderUserTurn({
      displayContent: queuedTurn.displayContent,
      persistedContent: preparedTurn.persistedContent,
      currentNote: preparedTurn.isCompact
        ? undefined
        : preparedTurn.request.currentNotePath,
      images: queuedMessageSnapshot.images,
    });
  }

  restorePendingMessagesToInput(): void {
    const { state } = this.host.deps;
    const queuedMessages = state.queuedMessages.map(cloneQueuedMessage);
    state.queuedMessages = [];
    for (const queuedMessage of queuedMessages.reverse()) {
      this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    }
  }

  processQueuedMessage(): void {
    const { state } = this.host.deps;
    const [nextQueuedMessage, ...remainingQueuedMessages] = state.queuedMessages;
    if (!nextQueuedMessage) return;

    const queuedMessage = cloneQueuedMessage(nextQueuedMessage);
    state.queuedMessages = remainingQueuedMessages;

    getActiveWindow(this.host.deps.getMessagesEl()).setTimeout(
      () => {
        void this.host.sendMessage({
          content: queuedMessage.content,
          images: queuedMessage.images,
          turnRequestOverride: toQueuedChatTurn(queuedMessage).request,
        });
      },
      0,
    );
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    restoreQueuedMessageToInput({
      message,
      inputEl: this.host.deps.getInputEl(),
      imageContextManager: this.host.deps.getImageContextManager(),
      resetInputHeight: () => this.host.deps.resetInputHeight(),
      mergeWithComposer: options.mergeWithComposer,
    });
  }
}
