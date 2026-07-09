import type { ChatMessage, ChatTurnRequestSnapshot, ImageAttachment, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import type { WorkspaceFileStore } from '@pivi/pivi-agent-core/ports';

export const PIVI_SESSION_META = 'pivi/session-meta';
export const PIVI_UI_CONTEXT = 'pivi/ui-context';
export const PIVI_MESSAGE_UI = 'pivi/message-ui';

export interface PiviSessionMetaData {
  title: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  createdAt: number;
  lastResponseAt?: number;
}

export interface PiviUiContextData {
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface PiviMessageUiData {
  targetEntryId: string;
  displayContent?: string;
  turnRequest?: ChatTurnRequestSnapshot;
  contentBlocks?: unknown[];
  toolCalls?: ChatMessage['toolCalls'];
  durationSeconds?: number;
  durationFlavorWord?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

/** Opaque agent message blob passed from the Pi adaptor at turn end. */
export type PersistedAgentMessage = Record<string, unknown>;

/** Active position in a session JSONL tree. */
export interface SessionRef {
  /** Vault-relative path to `.jsonl` file. */
  sessionFile: string;
  leafId?: string | null;
  /** Header `id` from the session file. */
  sessionId: string;
}

export interface LeafSummary {
  leafId: string;
  label?: string;
  updatedAt: number;
  messagePreview: string;
  /** Number of user/assistant messages visible up to this session state. */
  messageCount?: number;
  /** Number of human turns visible up to this session state. */
  turnCount?: number;
}

export interface StoreSessionInfo {
  sessionFile: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  leafCount: number;
  messagePreview: string;
}

export interface SessionUiContext {
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface SessionMetaPatch {
  title?: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  lastResponseAt?: number;
  createdAt?: number;
}

export interface UserTurnUi {
  displayContent?: string;
  images?: ImageAttachment[];
  turnRequest?: ChatTurnRequestSnapshot;
}

export interface MessageUiPatch {
  targetEntryId: string;
  displayContent?: string;
  turnRequest?: ChatTurnRequestSnapshot;
  contentBlocks?: ChatMessage['contentBlocks'];
  toolCalls?: ChatMessage['toolCalls'];
  durationSeconds?: number;
  durationFlavorWord?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

export interface SessionStore {
  listSessions(vaultPath: string): Promise<StoreSessionInfo[]>;
  create(vaultPath: string): Promise<SessionRef>;
  open(sessionFile: string, leafId?: string | null): Promise<SessionRef>;
  listLeaves(sessionFile: string): Promise<LeafSummary[]>;
  getMessages(ref: SessionRef): Promise<ChatMessage[]>;
  getUsage?(ref: SessionRef): Promise<UsageInfo | null>;
  appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef>;
  appendAgentTurn(ref: SessionRef, messages: PersistedAgentMessage[], ui?: MessageUiPatch[]): Promise<SessionRef>;
  appendMessageUiPatches?(ref: SessionRef, patches: MessageUiPatch[]): Promise<SessionRef>;
  setLeaf(ref: SessionRef, leafId: string | null): Promise<SessionRef>;
  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef>;
  deleteSession(sessionFile: string): Promise<void>;
  readUiContext(ref: SessionRef): Promise<SessionUiContext>;
  writeUiContext(ref: SessionRef, patch: Partial<SessionUiContext>): Promise<void>;
  writeSessionMeta(ref: SessionRef, patch: SessionMetaPatch): Promise<void>;
  sessionRefFromOpenSession(openSession: {
    sessionFile?: string;
    leafId?: string | null;
    sessionId?: string | null;
    id: string;
  }): SessionRef | null;
}

export type FileStore = WorkspaceFileStore;
