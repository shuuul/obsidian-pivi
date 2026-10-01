import type { BrowserSelectionContext } from '../context/browser';
import type { CanvasSelectionContext } from '../context/canvas';
import type { EditorSelectionContext } from '../context/editor';
import type { InlineContextReference } from '../context/inlineContext';
import type { ImageAttachment } from './chatTypes';

export interface ChatTurnRequest {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  attachedFilePaths?: string[];
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  inlineContexts?: InlineContextReference[];
  externalContextPaths?: string[];
  enabledMcpServers?: Set<string>;
  referencedSessions?: ReferencedSession[];
}

export interface ReferencedSession {
  sessionId: string;
  sessionFile: string;
  title: string;
}

export interface PreparedChatTurn {
  request: ChatTurnRequest;
  /** User-visible composer/history text, which may differ from the runtime prompt. */
  displayContent: string;
  persistedContent: string;
  prompt: string;
  isCompact: boolean;
  mcpMentions: Set<string>;
}

export interface PiTurnOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

export interface PiEnsureReadyOptions {
  allowSessionCreation?: boolean;
  force?: boolean;
}

export interface ConnectivityTestResult {
  ok: boolean;
  detail: string;
}

export interface ChatRewindResult {
  canRewind: boolean;
  leafId?: string | null;
  error?: string;
}

export interface ChatTurnMetadata {
  userMessageId?: string;
  userParentEntryId?: string | null;
  assistantMessageId?: string;
  wasSent?: boolean;
}
