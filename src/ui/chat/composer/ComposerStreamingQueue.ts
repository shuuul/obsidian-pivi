import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { SelectionController } from '../controllers/SelectionController';
import type { ChatState } from '../state/ChatState';
import type { AddExternalContextResult } from '../toolbar/ExternalContextControl';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { RichChatInput } from '../ui/RichChatInput';
import { createQueuedMessage, mergeQueuedMessages } from './ComposerQueue';
import { buildTurnSubmission } from './ComposerSubmission';

export interface QueueTurnWhileStreamingDeps {
  state: ChatState;
  inputEl: RichChatInput;
  imageContextManager: ImageContextManager | null;
  inlineContextManager: InlineContextManager | null;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getFileContextManager: () => FileContextManager | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  resetInputHeight: () => void;
  updateQueueIndicator: () => void;
}

export interface QueueTurnWhileStreamingOptions {
  content: string;
  promptContent?: string;
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
    getExternalContextSelector: deps.getExternalContextSelector,
  }, {
    content: options.content,
    promptContent: options.promptContent,
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
    deps.getFileContextManager()?.clearAfterSend();
  }

  deps.updateQueueIndicator();
}
