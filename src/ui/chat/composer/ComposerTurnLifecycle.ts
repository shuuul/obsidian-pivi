import type { ChatMessage } from '@pivi/core';
import { type ChatTurnRequest,cloneChatTurnRequest } from '@pivi/pi-runtime';

import type PiviPlugin from '@/app/PiviPluginHost';

import type { BrowserSelectionContext } from '../../shared/utils/browser';
import type { CanvasSelectionContext } from '../../shared/utils/canvas';
import type { EditorSelectionContext } from '../../shared/utils/editor';
import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { SelectionController } from '../controllers/SelectionController';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { AddExternalContextResult, McpServerSelector } from '../toolbar/InputToolbar';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { RichChatInput } from '../ui/RichChatInput';
import { buildTurnSubmission } from './ComposerSubmission';

export interface BeginOutgoingTurnDeps {
  plugin: PiviPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  inputEl: RichChatInput;
  imageContextManager: ImageContextManager | null;
  fileContextManager: FileContextManager | null;
  inlineContextManager: InlineContextManager | null;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getWelcomeEl: () => HTMLElement | null;
  getFileContextManager: () => FileContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getSubagentManager: () => SubagentManager;
  generateId: () => string;
  resetInputHeight: () => void;
}

export interface BeginOutgoingTurnOptions {
  content: string;
  shouldUseInput: boolean;
  imageOverride?: ChatMessage['images'];
  turnRequestOverride?: ChatTurnRequest;
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
}

export interface BeginOutgoingTurnResult {
  streamGeneration: number;
  displayContent: string;
  turnRequest: ChatTurnRequest;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
  imagesForMessage?: ChatMessage['images'];
  isCompact: boolean;
}

export function beginOutgoingTurn(
  deps: BeginOutgoingTurnDeps,
  options: BeginOutgoingTurnOptions,
): BeginOutgoingTurnResult {
  const {
    plugin,
    state,
    renderer,
    inputEl,
    imageContextManager,
    fileContextManager,
    inlineContextManager,
  } = deps;

  if (options.shouldUseInput) {
    inputEl.value = '';
    deps.resetInputHeight();
  }

  state.isStreaming = true;
  state.cancelRequested = false;
  state.ignoreUsageUpdates = false;
  deps.getSubagentManager().resetSpawnedCount();
  state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
  const streamGeneration = state.bumpStreamGeneration();

  deps.getWelcomeEl()?.addClass('pivi-hidden');

  fileContextManager?.startSession();

  const images = options.imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
  const imagesForMessage = images.length > 0 ? [...images] : undefined;
  const isCompact = /^\/compact(\s|$)/i.test(options.content);

  if (options.shouldUseInput) {
    imageContextManager?.clearImages();
  }

  const turnSubmission = options.turnRequestOverride
    ? {
      displayContent: options.content,
      turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
    }
    : buildTurnSubmission({
      selectionController: deps.selectionController,
      browserSelectionController: deps.browserSelectionController,
      canvasSelectionController: deps.canvasSelectionController,
      getFileContextManager: deps.getFileContextManager,
      getMcpServerSelector: deps.getMcpServerSelector,
      getExternalContextSelector: deps.getExternalContextSelector,
    }, {
      content: options.content,
      images: imagesForMessage,
      editorContextOverride: options.editorContextOverride,
      browserContextOverride: options.browserContextOverride,
      canvasContextOverride: options.canvasContextOverride,
    });
  const { displayContent, turnRequest } = turnSubmission;

  if (options.shouldUseInput) {
    inlineContextManager?.clearAfterSend();
  }

  fileContextManager?.markCurrentNoteSent();

  const userMsg: ChatMessage = {
    id: deps.generateId(),
    role: 'user',
    content: displayContent,
    displayContent,
    timestamp: Date.now(),
    images: imagesForMessage,
  };
  state.addMessage(userMsg);
  state.hasPendingSessionSave = true;
  renderer.addMessage(userMsg);

  const assistantMsg: ChatMessage = {
    id: deps.generateId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };

  return {
    streamGeneration,
    displayContent,
    turnRequest,
    userMsg,
    assistantMsg,
    imagesForMessage,
    isCompact,
  };
}
