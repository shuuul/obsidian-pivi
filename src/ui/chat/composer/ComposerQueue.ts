import {
  type ChatTurnRequest,
  cloneChatTurnRequest,
  type QueuedChatTurn,
} from '@pivi/pivi-agent-core/runtime';

import type { QueuedMessage } from '../state/types';

let nextQueuedMessageId = 1;

export function cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
  return {
    ...message,
    images: message.images ? [...message.images] : undefined,
    turnRequest: message.turnRequest
      ? cloneChatTurnRequest(message.turnRequest)
      : undefined,
  };
}

export function createQueuedMessage(
  displayContent: string,
  turnRequest: ChatTurnRequest,
): QueuedMessage {
  const request = cloneChatTurnRequest(turnRequest);
  return {
    id: `queued-turn-${nextQueuedMessageId++}`,
    content: displayContent,
    images: request.images,
    editorContext: request.editorSelection ?? null,
    browserContext: request.browserSelection ?? null,
    canvasContext: request.canvasSelection ?? null,
    turnRequest: request,
  };
}

export function toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
  if (message.turnRequest) {
    return {
      displayContent: message.content,
      request: cloneChatTurnRequest(message.turnRequest),
    };
  }

  return {
    displayContent: message.content,
    request: {
      text: message.content,
      images: message.images ? [...message.images] : undefined,
      editorSelection: message.editorContext,
      browserSelection: message.browserContext ?? null,
      canvasSelection: message.canvasContext,
    },
  };
}
