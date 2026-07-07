import type { ChatMessage, OpenSessionState, StreamChunk, ToolCallInfo } from '../foundation';
import type {
  ChatRewindResult,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PiEnsureReadyOptions,
  PiTurnOptions,
  PreparedChatTurn,
} from './types';

export interface PiChatService {
  prepareTurn(request: ChatTurnRequest): PreparedChatTurn;
  onReadyStateChange(listener: (ready: boolean) => void): () => void;
  /** Subscribe to background subagent events emitted after the parent turn stream ends. */
  onSubagentChunk?(listener: (chunk: StreamChunk) => void | Promise<void>): () => void;
  syncSession(
    ref: { sessionFile: string | null; leafId?: string | null } | null,
    externalContextPaths?: string[],
  ): void;
  reloadMcpServers(): Promise<void>;
  ensureReady(options?: PiEnsureReadyOptions): Promise<boolean>;
  /** Hot-update system prompt when settings change without rebuilding the agent session. */
  syncSystemPrompt?(): Promise<void>;
  /** Apply the current thinking-effort setting to an active agent session. */
  syncThinkingLevel?(): void;
  query(
    turn: PreparedChatTurn,
    openSessionHistory?: ChatMessage[],
    queryOptions?: PiTurnOptions,
  ): AsyncGenerator<StreamChunk>;
  cancel(): void;
  resetSession(): void;
  getSessionId(): string | null;
  isReady(): boolean;
  getAuxiliaryModel?(): string | null;
  cleanup(): void;
  rewind(checkpointId: string | null): Promise<ChatRewindResult>;
  consumeTurnMetadata(): ChatTurnMetadata;
  getSessionStateUpdates(): Partial<OpenSessionState>;

  loadSubagentToolCalls?(agentId: string): Promise<ToolCallInfo[]>;
  loadSubagentFinalResult?(agentId: string): Promise<string | null>;

  testConnectivity?(): Promise<ConnectivityTestResult>;
}
