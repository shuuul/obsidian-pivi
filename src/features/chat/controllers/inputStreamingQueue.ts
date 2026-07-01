import type { ChatMessage } from '../../../pi/types';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { RichChatInput } from '../ui/RichChatInput';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import { createQueuedMessage, mergeQueuedMessages } from './inputQueue';
import { buildTurnSubmission } from './inputTurnSubmission';
import type { SelectionController } from './SelectionController';

export interface QueueTurnWhileStreamingDeps {
  state: ChatState;
  inputEl: RichChatInput;
  imageContextManager: ImageContextManager | null;
  inlineContextManager: InlineContextManager | null;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getFileContextManager: () => FileContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  resetInputHeight: () => void;
  updateQueueIndicator: () => void;
}

export interface QueueTurnWhileStreamingOptions {
  content: string;
  shouldUseInput: boolean;
  hasImages: boolean;
  imageOverride?: ChatMessage['images'];
}

export function queueTurnWhileStreaming(
  deps: QueueTurnWhileStreamingDeps,
  options: QueueTurnWhileStreamingOptions,
): void {
  const {
    state,
    inputEl,
    imageContextManager,
    inlineContextManager,
    selectionController,
    browserSelectionController,
    canvasSelectionController,
  } = deps;

  const images = options.hasImages
    ? [...(options.imageOverride ?? imageContextManager?.getAttachedImages() ?? [])]
    : undefined;
  const editorContext = selectionController.getContext();
  const browserContext = browserSelectionController?.getContext() ?? null;
  const canvasContext = canvasSelectionController.getContext();
  const { displayContent, turnRequest } = buildTurnSubmission({
    selectionController,
    browserSelectionController,
    canvasSelectionController,
    getFileContextManager: deps.getFileContextManager,
    getMcpServerSelector: deps.getMcpServerSelector,
    getExternalContextSelector: deps.getExternalContextSelector,
  }, {
    content: options.content,
    images,
    editorContextOverride: editorContext,
    browserContextOverride: browserContext,
    canvasContextOverride: canvasContext,
  });
  state.queuedMessage = mergeQueuedMessages(
    state.queuedMessage,
    createQueuedMessage(displayContent, turnRequest),
  );

  if (options.shouldUseInput) {
    inputEl.value = '';
    deps.resetInputHeight();
    imageContextManager?.clearImages();
    inlineContextManager?.clearAfterSend();
  }

  deps.updateQueueIndicator();
}
