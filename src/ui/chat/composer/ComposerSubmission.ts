import type { BrowserSelectionContext } from '@pivi/agent/context/browser';
import type { CanvasSelectionContext } from '@pivi/agent/context/canvas';
import type { EditorSelectionContext } from '@pivi/agent/context/editor';
import { extractInlineContextTokensFromMessage } from '@pivi/agent/context/inlineContext';
import type { ChatMessage } from '@pivi/agent/foundation';
import type { ChatTurnRequest } from '@pivi/agent/runtime';

import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { SelectionController } from '../controllers/SelectionController';
import type { AddExternalContextResult } from '../toolbar/ExternalContextControl';
import type { FileContextManager } from '../ui/FileContext';

export interface TurnSubmissionContext {
  content: string;
  /** Runtime prompt text when it intentionally differs from the composer/history text. */
  promptContent?: string;
  images?: ChatMessage['images'];
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
}

export interface TurnSubmissionSources {
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getFileContextManager: () => FileContextManager | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
}

function collectReferencedSessions(
  manager: FileContextManager | null,
  content: string,
): ChatTurnRequest['referencedSessions'] {
  return typeof manager?.collectReferencedSessions === 'function'
    ? manager.collectReferencedSessions(content)
    : undefined;
}

/** Build display text and provider-neutral turn request from composer state. */
export function buildTurnSubmission(
  sources: TurnSubmissionSources,
  options: TurnSubmissionContext,
): {
  displayContent: string;
  turnRequest: ChatTurnRequest;
} {
  const fileContextManager = sources.getFileContextManager();
  const externalContextSelector = sources.getExternalContextSelector();

  const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
  const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

  const editorContext = options.editorContextOverride ?? null;
  const browserContext = options.browserContextOverride !== undefined
    ? options.browserContextOverride
    : (sources.browserSelectionController?.getContext() ?? null);
  const canvasContext = options.canvasContextOverride !== undefined
    ? options.canvasContextOverride
    : sources.canvasSelectionController.getContext();

  const externalContextPaths = externalContextSelector?.getExternalContexts();
  const promptContent = options.promptContent ?? options.content;
  const isCompact = /^\/compact(\s|$)/i.test(promptContent);
  const inlineContextExtraction = !isCompact
    ? extractInlineContextTokensFromMessage(promptContent)
    : { messageWithoutInlineContextTokens: promptContent, contexts: [] };
  const contentWithoutInlineContextTokens = inlineContextExtraction.messageWithoutInlineContextTokens;
  const attachedFiles = !isCompact
    ? fileContextManager?.collectContextFilePathsForTurn(contentWithoutInlineContextTokens)
    : undefined;
  const inlineContexts = !isCompact
    ? (inlineContextExtraction.contexts.length > 0 ? inlineContextExtraction.contexts : undefined)
    : undefined;
  const transformedText = !isCompact && fileContextManager
    ? fileContextManager.transformContextMentions(contentWithoutInlineContextTokens)
    : contentWithoutInlineContextTokens;

  return {
    displayContent: options.content,
    turnRequest: {
      text: transformedText,
      images: options.images,
      currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
      attachedFilePaths: attachedFiles,
      inlineContexts,
      editorSelection: editorContext,
      browserSelection: browserContext,
      canvasSelection: canvasContext,
      externalContextPaths: externalContextPaths && externalContextPaths.length > 0
        ? externalContextPaths
        : undefined,
      referencedSessions: !isCompact
        ? collectReferencedSessions(fileContextManager, promptContent)
        : undefined,
      // Settings-enabled MCP servers are active by default; slash mentions remain optional emphasis.
    },
  };
}
