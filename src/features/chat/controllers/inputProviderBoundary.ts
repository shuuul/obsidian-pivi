import type { ChatMessage, StreamChunk } from '../../../pi/types';

export type ProviderBoundaryChunkType = 'user_message_start' | 'assistant_message_start';

export function getProviderBoundaryChunkType(
  chunk: StreamChunk,
): ProviderBoundaryChunkType | null {
  if (chunk.type === 'user_message_start' || chunk.type === 'assistant_message_start') {
    return chunk.type;
  }
  return null;
}

export function isUserMessageStartChunk(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: 'user_message_start' }> {
  return chunk.type === 'user_message_start';
}

export function isAssistantMessageStartChunk(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: 'assistant_message_start' }> {
  return chunk.type === 'assistant_message_start';
}

/** Drop empty assistant placeholder created before the first provider user_message_start. */
export function shouldDiscardPendingAssistantPlaceholder(
  awaitingProviderAssistantStart: boolean,
  message: ChatMessage | null,
): boolean {
  return awaitingProviderAssistantStart
    && !!message
    && !message.content.trim()
    && (message.toolCalls?.length ?? 0) === 0
    && (message.contentBlocks?.length ?? 0) === 0;
}

/**
 * Some runtimes emit assistant-start markers for each internal model/tool loop.
 * Without a preceding provider user boundary, keep rendering in the same visible
 * assistant message so tool batches do not gain artificial blank gaps.
 */
export function shouldIgnoreAssistantContinuationBoundary(
  awaitingProviderAssistantStart: boolean,
  message: ChatMessage | null,
): boolean {
  return !awaitingProviderAssistantStart
    && !!message;
}
