import type { InlineContextReference } from '../context';
import type { ChatTurnRequestSnapshot, ImageAttachment } from '../foundation';
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

export function toChatTurnRequestSnapshot(request: ChatTurnRequest): ChatTurnRequestSnapshot {
  return {
    text: request.text,
    currentNotePath: request.currentNotePath,
    attachedFilePaths: request.attachedFilePaths
      ? [...request.attachedFilePaths]
      : undefined,
    editorSelection: cloneSerializable(request.editorSelection),
    browserSelection: cloneSerializable(request.browserSelection),
    canvasSelection: cloneSerializable(request.canvasSelection),
    inlineContexts: cloneSerializable(request.inlineContexts),
    externalContextPaths: request.externalContextPaths
      ? [...request.externalContextPaths]
      : undefined,
    enabledMcpServers: request.enabledMcpServers
      ? [...request.enabledMcpServers]
      : undefined,
  };
}

export function chatTurnRequestFromSnapshot(
  snapshot: ChatTurnRequestSnapshot,
  images?: ImageAttachment[],
): ChatTurnRequest {
  return {
    text: snapshot.text,
    images: cloneImages(images ?? snapshot.images),
    currentNotePath: snapshot.currentNotePath,
    attachedFilePaths: snapshot.attachedFilePaths
      ? [...snapshot.attachedFilePaths]
      : undefined,
    editorSelection: cloneSerializable(snapshot.editorSelection) as ChatTurnRequest['editorSelection'],
    browserSelection: cloneSerializable(snapshot.browserSelection) as ChatTurnRequest['browserSelection'],
    canvasSelection: cloneSerializable(snapshot.canvasSelection) as ChatTurnRequest['canvasSelection'],
    inlineContexts: cloneSerializable(snapshot.inlineContexts) as ChatTurnRequest['inlineContexts'],
    externalContextPaths: snapshot.externalContextPaths
      ? [...snapshot.externalContextPaths]
      : undefined,
    enabledMcpServers: snapshot.enabledMcpServers
      ? new Set(snapshot.enabledMcpServers)
      : undefined,
  };
}

function cloneImages(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  return images && images.length > 0 ? [...images] : undefined;
}

function cloneSerializable<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  // Obsidian's supported Electron runtime has structuredClone. The JSON fallback
  // only preserves JSON-compatible values for older/test environments.
  return JSON.parse(JSON.stringify(value)) as T;
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
