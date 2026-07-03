import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';

import {
  cloneQueuedMessage,
  toQueuedChatTurn,
} from '@/ui/chat/composer/ComposerQueue';
import { renderQueueIndicator } from '@/ui/chat/composer/ComposerQueueIndicator';
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
}

export class InputQueueRestoreCoordinator {
  private readonly host: InputQueueRestoreHost;

  constructor(host: InputQueueRestoreHost) {
    this.host = host;
  }

  updateQueueIndicator(): void {
    const { state } = this.host.deps;
    renderQueueIndicator({
      indicatorEl: state.queueIndicatorEl,
      queuedMessage: state.queuedMessage,
      onEdit: () => this.withdrawQueuedMessageToComposer(),
      onDiscard: () => this.clearQueuedMessage(),
    });
  }

  clearQueuedMessage(): void {
    const { state } = this.host.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  withdrawQueuedMessageToComposer(): void {
    const { state } = this.host.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  restorePendingMessagesToInput(): void {
    const { state } = this.host.deps;
    const queuedMessage = state.queuedMessage
      ? cloneQueuedMessage(state.queuedMessage)
      : null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  processQueuedMessage(): void {
    const { state } = this.host.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateQueueIndicator();

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