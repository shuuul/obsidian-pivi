import type { BrowserSelectionContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import type { EditorSelectionContext } from '../../utils/editor';
import type { InlineContextReference } from '../../utils/inlineContext';
import type {
  ApprovalDecision,
  ImageAttachment,
  OpenSessionState,
} from '../types';

export interface ApprovalDecisionOption {
  label: string;
  description?: string;
  value: string;
  decision?: ApprovalDecision;
}

export interface ApprovalNetworkContext {
  host: string;
  protocol: string;
}

export interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
  decisionOptions?: ApprovalDecisionOption[];
  networkApprovalContext?: ApprovalNetworkContext;
  additionalPermissions?: unknown;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
  options?: ApprovalCallbackOptions,
) => Promise<ApprovalDecision>;

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
  persistedContent: string;
  prompt: string;
  isCompact: boolean;
  mcpMentions: Set<string>;
}

export interface ChatRuntimeQueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

export interface ChatRuntimeEnsureReadyOptions {
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

export type ChatRuntimeOpenSession = Pick<
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
  planCompleted?: boolean;
}

export type { ApprovalDecision };
