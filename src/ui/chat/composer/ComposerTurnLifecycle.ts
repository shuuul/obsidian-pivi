import type { BrowserSelectionContext } from '@pivi/pivi-agent-core/context/browser';
import type { CanvasSelectionContext } from '@pivi/pivi-agent-core/context/canvas';
import type { EditorSelectionContext } from '@pivi/pivi-agent-core/context/editor';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import {
  type ChatTurnRequest,
  cloneChatTurnRequest,
  toChatTurnRequestSnapshot,
} from '@pivi/pivi-agent-core/runtime';
import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';

import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { SelectionController } from '../controllers/SelectionController';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { AddExternalContextResult } from '../toolbar/ExternalContextControl';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { RichChatInput } from '../ui/RichChatInput';
import { buildTurnSubmission } from './ComposerSubmission';

export interface BeginOutgoingTurnDeps {
  settings: ChatSettingsPort;
  state: ChatState;
  inputEl: RichChatInput;
  imageContextManager: ImageContextManager | null;
  fileContextManager: FileContextManager | null;
  inlineContextManager: InlineContextManager | null;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getFileContextManager: () => FileContextManager | null;
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
  promptContent?: string;
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
    settings,
    state,
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
  state.autoScrollEnabled = settings.getSettingsSnapshot().enableAutoScroll;
  const streamGeneration = state.bumpStreamGeneration();


  fileContextManager?.startSession();

  const images = options.imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
  const imagesForMessage = images.length > 0 ? [...images] : undefined;
  const isCompact = /^\/compact(\s|$)/i.test(options.content);

  if (options.shouldUseInput) {
    imageContextManager?.clearImages();
  }

  let turnSubmission: ReturnType<typeof buildTurnSubmission>;
  if (options.turnRequestOverride) {
    const turnRequest = cloneChatTurnRequest(options.turnRequestOverride);
    const externalContextPaths = deps.getExternalContextSelector()?.getExternalContexts() ?? [];
    // Overrides reproduce historical/queued content, not historical permissions.
    // External-context selections are always captured from the current UI at execution.
    // MCP availability comes from settings-enabled servers (no per-turn toolbar pick).
    turnRequest.externalContextPaths = externalContextPaths.length > 0
      ? [...externalContextPaths]
      : undefined;
    turnRequest.enabledMcpServers = undefined;
    turnSubmission = {
      displayContent: options.content,
      turnRequest,
    };
  } else {
    turnSubmission = buildTurnSubmission({
      selectionController: deps.selectionController,
      browserSelectionController: deps.browserSelectionController,
      canvasSelectionController: deps.canvasSelectionController,
      getFileContextManager: deps.getFileContextManager,
      getExternalContextSelector: deps.getExternalContextSelector,
    }, {
      content: options.content,
      promptContent: options.promptContent,
      images: imagesForMessage,
      editorContextOverride: options.editorContextOverride,
      browserContextOverride: options.browserContextOverride,
      canvasContextOverride: options.canvasContextOverride,
    });
  }
  const { displayContent, turnRequest } = turnSubmission;

  // A successfully assembled submission replaces the empty-session welcome surface.
  state.welcomeGreeting = null;

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
    turnRequest: toChatTurnRequestSnapshot(turnRequest),
  };
  state.addMessage(userMsg);
  state.hasPendingSessionSave = true;

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
