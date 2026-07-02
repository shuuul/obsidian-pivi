import type { ImageAttachment } from '@pivi/core';

import type { InlineContextReference } from './context/inlineContext';
import type { ChatTurnRequest } from './types';

export interface QueuedChatTurn {
  displayContent: string;
  request: ChatTurnRequest;
}

export function cloneChatTurnRequest(request: ChatTurnRequest): ChatTurnRequest {
  return {
    ...request,
    images: cloneImages(request.images),
    attachedFilePaths: request.attachedFilePaths
      ? [...request.attachedFilePaths]
      : undefined,
    inlineContexts: cloneInlineContexts(request.inlineContexts),
    externalContextPaths: request.externalContextPaths
      ? [...request.externalContextPaths]
      : undefined,
    enabledMcpServers: request.enabledMcpServers
      ? new Set(request.enabledMcpServers)
      : undefined,
  };
}

export function cloneQueuedChatTurn(turn: QueuedChatTurn): QueuedChatTurn {
  return {
    displayContent: turn.displayContent,
    request: cloneChatTurnRequest(turn.request),
  };
}

export function mergeQueuedChatTurns(
  existing: QueuedChatTurn,
  incoming: QueuedChatTurn,
): QueuedChatTurn {
  const existingRequest = existing.request;
  const incomingRequest = incoming.request;

  return {
    displayContent: mergeText(existing.displayContent, incoming.displayContent),
    request: {
      ...cloneChatTurnRequest(incomingRequest),
      text: mergeText(existingRequest.text, incomingRequest.text),
      images: mergeImages(existingRequest.images, incomingRequest.images),
      currentNotePath: incomingRequest.currentNotePath ?? existingRequest.currentNotePath,
      attachedFilePaths: mergeStringLists(
        existingRequest.attachedFilePaths,
        incomingRequest.attachedFilePaths,
      ),
      inlineContexts: mergeInlineContexts(
        existingRequest.inlineContexts,
        incomingRequest.inlineContexts,
      ),
      externalContextPaths: mergeStringLists(
        existingRequest.externalContextPaths,
        incomingRequest.externalContextPaths,
      ),
      enabledMcpServers: mergeSets(
        existingRequest.enabledMcpServers,
        incomingRequest.enabledMcpServers,
      ),
    },
  };
}

function mergeText(first: string, second: string): string {
  return [first, second]
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join('\n\n');
}

function cloneImages(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  return images && images.length > 0 ? [...images] : undefined;
}

function mergeImages(
  first: ImageAttachment[] | undefined,
  second: ImageAttachment[] | undefined,
): ImageAttachment[] | undefined {
  const merged = [...(first ?? []), ...(second ?? [])];
  return merged.length > 0 ? merged : undefined;
}

function mergeStringLists(
  first: string[] | undefined,
  second: string[] | undefined,
): string[] | undefined {
  const merged = [...(first ?? []), ...(second ?? [])];
  if (merged.length === 0) {
    return undefined;
  }
  return Array.from(new Set(merged));
}

function cloneInlineContexts(
  contexts: InlineContextReference[] | undefined,
): InlineContextReference[] | undefined {
  if (!contexts || contexts.length === 0) {
    return undefined;
  }
  return contexts.map((ctx) => ({
    ...ctx,
    selection: {
      from: { ...ctx.selection.from },
      to: { ...ctx.selection.to },
    },
    includedLines: { ...ctx.includedLines },
  }));
}

function mergeInlineContexts(
  first: InlineContextReference[] | undefined,
  second: InlineContextReference[] | undefined,
): InlineContextReference[] | undefined {
  const merged = [...(first ?? []), ...(second ?? [])];
  if (merged.length === 0) {
    return undefined;
  }
  const unique: InlineContextReference[] = [];
  for (const ctx of merged) {
    const duplicate = unique.some((existing) =>
      existing.notePath === ctx.notePath
        && existing.selection.from.line === ctx.selection.from.line
        && existing.selection.from.ch === ctx.selection.from.ch
        && existing.selection.to.line === ctx.selection.to.line
        && existing.selection.to.ch === ctx.selection.to.ch);
    if (!duplicate) {
      unique.push(ctx);
    }
  }
  return unique.length > 0 ? unique : undefined;
}

function mergeSets<T>(
  first: Set<T> | undefined,
  second: Set<T> | undefined,
): Set<T> | undefined {
  const merged = new Set<T>();
  for (const value of first ?? []) {
    merged.add(value);
  }
  for (const value of second ?? []) {
    merged.add(value);
  }
  return merged.size > 0 ? merged : undefined;
}
