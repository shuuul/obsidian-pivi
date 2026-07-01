import type { ChatMessage, ImageAttachment } from '../../pi/types/chat';

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
  /** @deprecated Use `turnCount`; retained for older UI call sites. */
  depth?: number;
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
}

export interface MessageUiPatch {
  targetEntryId: string;
  displayContent?: string;
  contentBlocks?: ChatMessage['contentBlocks'];
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
  appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef>;
  appendAgentTurn(ref: SessionRef, messages: PersistedAgentMessage[], ui?: MessageUiPatch[]): Promise<SessionRef>;
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
