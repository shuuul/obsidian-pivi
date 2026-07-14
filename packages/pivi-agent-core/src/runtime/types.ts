import type { BrowserSelectionContext } from '../context';
import type { CanvasSelectionContext } from '../context';
import type { EditorSelectionContext } from '../context';
import type { InlineContextReference } from '../context';
import type {
  ImageAttachment,
  OpenSessionState,
} from '../foundation';


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

export type PiSessionBinding = Pick<
  OpenSessionState,
  'sessionId' | 'sessionFile' | 'leafId' | 'agentState'
>;

export interface SessionUpdateResult {
  updates: Partial<OpenSessionState>;
}

export interface ChatTurnMetadata {
  userMessageId?: string;
  userParentEntryId?: string | null;
  assistantMessageId?: string;
  wasSent?: boolean;
}
