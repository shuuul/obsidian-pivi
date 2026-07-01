import type { ChatMessage, OpenSessionState, StreamChunk, ToolCallInfo } from '../types';
import type {
  ApprovalCallback,
  ChatRewindResult,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeOpenSession,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PreparedChatTurn,
  SessionUpdateResult,
} from './types';

export interface ChatRuntime {
  prepareTurn(request: ChatTurnRequest): PreparedChatTurn;
  onReadyStateChange(listener: (ready: boolean) => void): () => void;
  syncOpenSessionState(
    openSession: ChatRuntimeOpenSession | null,
    externalContextPaths?: string[],
  ): void;
  reloadMcpServers(): Promise<void>;
  ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean>;
  /** Hot-update system prompt when settings change without rebuilding the agent session. */
  syncSystemPrompt?(): Promise<void>;
  /** Apply the current thinking-effort setting to an active agent session. */
  syncThinkingLevel?(): void;
  query(
    turn: PreparedChatTurn,
    openSessionHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk>;
  cancel(): void;
  resetSession(): void;
  getSessionId(): string | null;
  consumeSessionInvalidation(): boolean;
  isReady(): boolean;
  getAuxiliaryModel?(): string | null;
  cleanup(): void;
  rewind(checkpointId: string | null): Promise<ChatRewindResult>;
  setApprovalCallback(callback: ApprovalCallback | null): void;
  consumeTurnMetadata(): ChatTurnMetadata;

  buildSessionUpdates(params: {
    openSession: OpenSessionState | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult;

  resolveSessionIdForFork(openSession: OpenSessionState | null): string | null;

  loadSubagentToolCalls?(agentId: string): Promise<ToolCallInfo[]>;
  loadSubagentFinalResult?(agentId: string): Promise<string | null>;

  testConnectivity?(): Promise<ConnectivityTestResult>;
}
