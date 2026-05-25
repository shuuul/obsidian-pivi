import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { EditorSelectionContext } from '../../../utils/editor';
import { extractInlineContextTokensFromMessage } from '../../../utils/inlineContext';
import type { FileContextManager } from '../ui/FileContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import type { SelectionController } from './SelectionController';

export interface TurnSubmissionContext {
  content: string;
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
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
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
  const mcpServerSelector = sources.getMcpServerSelector();
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
  const isCompact = /^\/compact(\s|$)/i.test(options.content);
  const inlineContextExtraction = !isCompact
    ? extractInlineContextTokensFromMessage(options.content)
    : { messageWithoutInlineContextTokens: options.content, contexts: [] };
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
  const enabledMcpServers = mcpServerSelector?.getEnabledServers();

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
      enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
        ? enabledMcpServers
        : undefined,
    },
  };
}
