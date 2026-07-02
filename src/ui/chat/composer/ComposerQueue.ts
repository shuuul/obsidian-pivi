import {
  type ChatTurnRequest,
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from '@pivi/pi-runtime';

import type { QueuedMessage } from '../state/types';

/** Short preview for the queued-message indicator. */
export function formatQueuedMessagePreview(message: QueuedMessage | null): string {
  if (!message) {
    return '';
  }

  const rawContent = message.content.trim();
  const preview = rawContent.length > 40
    ? `${rawContent.slice(0, 40)}...`
    : rawContent;
  const hasImages = (message.images?.length ?? 0) > 0;

  if (hasImages) {
    return preview ? `${preview} [images]` : '[images]';
  }

  return preview;
}

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

export function mergeQueuedMessages(
  existing: QueuedMessage | null,
  incoming: QueuedMessage,
): QueuedMessage {
  if (!existing) {
    return cloneQueuedMessage(incoming);
  }

  const mergedTurn = mergeQueuedChatTurns(
    toQueuedChatTurn(existing),
    toQueuedChatTurn(incoming),
  );
  return createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
}

export function mergePendingQueuedMessages(
  first: QueuedMessage | null,
  second: QueuedMessage | null,
): QueuedMessage | null {
  if (first && second) {
    return mergeQueuedMessages(first, second);
  }
  if (first) {
    return cloneQueuedMessage(first);
  }
  if (second) {
    return cloneQueuedMessage(second);
  }
  return null;
}
