import type {
  ChatMessage,
  ChatTurnRequestSnapshot,
  ImageAttachment,
  SessionTitleSource,
  UsageInfo,
} from '../foundation';
import type { WorkspaceFileStore } from '../ports';

export type { SessionTitleSource };

export class SessionIndexError extends Error {
  constructor(
    message: string,
    readonly sessionFile: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The sidecar no longer describes the authoritative JSONL bytes. */
export class SessionIndexStaleError extends SessionIndexError {}

/** The sidecar or authoritative JSONL cannot form a valid range index. */
export class SessionIndexCorruptError extends SessionIndexError {}

/** A requested message-page cursor does not identify a projected message. */
export class SessionRangeCursorError extends SessionIndexError {
  constructor(
    message: string,
    sessionFile: string,
    readonly beforeEntryId: string,
    options?: ErrorOptions,
  ) {
    super(message, sessionFile, options);
  }
}

export const PIVI_SESSION_META = 'pivi/session-meta';
export const PIVI_UI_CONTEXT = 'pivi/ui-context';
export const PIVI_MESSAGE_UI = 'pivi/message-ui';
export const PIVI_COMPACTION_BOUNDARY = 'pivi/compaction-boundary';

export interface PiviSessionMetaData {
  title: string;
  titleSource?: SessionTitleSource;
  createdAt: number;
  lastResponseAt?: number;
}

export interface PiviUiContextData {
  currentNote?: string;
  enabledMcpServers?: string[];
}

/** Device-local overlay for absolute paths that must never enter synced JSONL. */
export interface DeviceLocalExternalContextStore {
  getSessionPaths(sessionFile: string): string[];
  setSessionPaths(sessionFile: string, paths: readonly string[]): void;
  getTurnPaths(sessionFile: string, entryId: string): string[];
  setTurnPaths(sessionFile: string, entryId: string, paths: readonly string[]): void;
  copySession(sourceSessionFile: string, targetSessionFile: string): void;
  deleteSession(sessionFile: string): void;
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

/** A bounded page of durable UI messages reconstructed from a session file. */
export interface SessionMessagePage {
  messages: ChatMessage[];
  hasOlder: boolean;
  totalMessageCount: number;
  /** Number of durable projected messages before the first message in this page. */
  olderMessageCount: number;
  /** Number of durable user messages before the first message in this page. */
  olderUserMessageCount: number;
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
  titleSource?: SessionTitleSource;
  updatedAt: number;
  leafCount: number;
  messagePreview: string;
  messageCount?: number;
}

export interface SessionUiContext {
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface SessionMetaPatch {
  title?: string;
  titleSource?: SessionTitleSource;
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
  /** Move legacy absolute paths out of synced JSONL into the device-local overlay. */
  migrateDeviceLocalExternalContexts?(): Promise<number>;
  listSessions(vaultPath: string): Promise<StoreSessionInfo[]>;
  create(vaultPath: string): Promise<SessionRef>;
  open(sessionFile: string): Promise<SessionRef>;
  getMessages(ref: SessionRef): Promise<ChatMessage[]>;
  openRecent(ref: SessionRef, limit: number): Promise<SessionMessagePage>;
  readOlder(
    ref: SessionRef,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage>;
  getUsage?(ref: SessionRef): Promise<UsageInfo | null>;
  appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef>;
  appendAgentTurn(ref: SessionRef, messages: PersistedAgentMessage[], ui?: MessageUiPatch[]): Promise<SessionRef>;
  appendMessageUiPatches?(ref: SessionRef, patches: MessageUiPatch[]): Promise<SessionRef>;
  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef>;
  deleteSession(sessionFile: string): Promise<void>;
  readUiContext(ref: SessionRef): Promise<SessionUiContext>;
  writeUiContext(ref: SessionRef, patch: Partial<SessionUiContext>): Promise<void>;
  writeSessionMeta(ref: SessionRef, patch: SessionMetaPatch): Promise<void>;
  sessionRefFromOpenSession(openSession: {
    sessionFile?: string;
    sessionId?: string | null;
    id: string;
  }): SessionRef | null;
}

export type FileStore = WorkspaceFileStore;
