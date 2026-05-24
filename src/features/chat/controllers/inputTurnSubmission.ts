import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { EditorSelectionContext } from '../../../utils/editor';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import type { SelectionController } from './SelectionController';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { FileContextManager } from '../ui/FileContext';

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

  const editorContext = options.editorContextOverride !== undefined
    ? options.editorContextOverride
    : sources.selectionController.getContext();
  const browserContext = options.browserContextOverride !== undefined
    ? options.browserContextOverride
    : (sources.browserSelectionController?.getContext() ?? null);
  const canvasContext = options.canvasContextOverride !== undefined
    ? options.canvasContextOverride
    : sources.canvasSelectionController.getContext();

  const externalContextPaths = externalContextSelector?.getExternalContexts();
  const attachedFiles = fileContextManager?.getAttachedFiles();
  const isCompact = /^\/compact(\s|$)/i.test(options.content);
  const transformedText = !isCompact && fileContextManager
    ? fileContextManager.transformContextMentions(options.content)
    : options.content;
  const enabledMcpServers = mcpServerSelector?.getEnabledServers();

  return {
    displayContent: options.content,
    turnRequest: {
      text: transformedText,
      images: options.images,
      currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
      attachedFilePaths: attachedFiles && attachedFiles.size > 0
        ? [...attachedFiles]
        : undefined,
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
