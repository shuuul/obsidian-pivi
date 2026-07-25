import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';

import {
  cloneQueuedMessage,
  toQueuedChatTurn,
} from '@/ui/chat/composer/ComposerQueue';
import { restoreQueuedMessageToInput } from '@/ui/chat/composer/ComposerQueueRestore';
import {
  isCompactCommandText,
  isSubmissionBlockedByContextLimit,
} from '@/ui/chat/composer/contextOverLimitNotice';
import { getActiveWindow } from '@/ui/shared/dom';

import type { QueuedMessage } from '../state/types';
import type { InputControllerDeps } from './InputController';

export interface InputQueueRestoreHost {
  readonly deps: InputControllerDeps;
  sendMessage(options?: {
    content?: string;
    images?: ChatMessage['images'];
    onSubmissionAccepted?: () => void;
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
  private pendingQueuedMessageId: string | null = null;

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

  reorderQueuedMessages(ids: readonly string[]): boolean {
    const { state } = this.host.deps;
    if (
      ids.length !== state.queuedMessages.length
      || new Set(ids).size !== ids.length
    ) return false;
    const messagesById = new Map(state.queuedMessages.map(message => [message.id, message]));
    const reordered: QueuedMessage[] = [];
    for (const id of ids) {
      const message = messagesById.get(id);
      if (!message) return false;
      reordered.push(message);
    }
    state.queuedMessages = reordered;
    return true;
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
    // Compaction is a standalone runtime path, not a Pi steering message. Leave
    // it queued for normal execution after the active run settles. Ordinary
    // over-limit steering also stays recoverable in the queue.
    if (
      isCompactCommandText(queuedTurn.request.text)
      || isSubmissionBlockedByContextLimit(state.usage, queuedTurn.request.text)
    ) return;
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
    if (state.isStreaming || this.pendingQueuedMessageId) return;

    const nextQueuedMessage = this.getNextExecutableQueuedMessage();
    if (!nextQueuedMessage) return;

    const queuedMessage = cloneQueuedMessage(nextQueuedMessage);
    const queuedMessageId = nextQueuedMessage.id;
    this.pendingQueuedMessageId = queuedMessageId;

    getActiveWindow(this.host.deps.getMessagesEl()).setTimeout(
      () => {
        if (state.isStreaming) {
          this.pendingQueuedMessageId = null;
          return;
        }
        const currentCandidate = this.getNextExecutableQueuedMessage();
        if (currentCandidate?.id !== queuedMessageId) {
          this.pendingQueuedMessageId = null;
          this.processQueuedMessage();
          return;
        }
        void this.host.sendMessage({
          content: queuedMessage.content,
          images: queuedMessage.images,
          onSubmissionAccepted: () => {
            state.queuedMessages = state.queuedMessages.filter(
              message => message.id !== queuedMessageId,
            );
          },
          turnRequestOverride: toQueuedChatTurn(currentCandidate).request,
        }).finally(() => {
          if (this.pendingQueuedMessageId === queuedMessageId) {
            this.pendingQueuedMessageId = null;
          }
        });
      },
      0,
    );
  }

  private getNextExecutableQueuedMessage(): QueuedMessage | undefined {
    const { queuedMessages, usage } = this.host.deps.state;
    const head = queuedMessages[0];
    if (!head) return undefined;
    if (!isSubmissionBlockedByContextLimit(usage, toQueuedChatTurn(head).request.text)) {
      return head;
    }
    return queuedMessages.find(message =>
      isCompactCommandText(toQueuedChatTurn(message).request.text));
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
