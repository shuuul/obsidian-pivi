import type { ChatMessage, StreamChunk } from '../foundation';
import type { ChatRewindResult, ChatTurnMetadata, PreparedChatTurn } from '../runtime/types';

export interface AgentEngineTurnOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

export interface AgentEngineSessionRef {
  sessionFile: string | null;
  leafId?: string | null;
}

export interface AgentEngine {
  syncSession(ref: AgentEngineSessionRef | null, externalContextPaths?: string[]): void;
  query(
    turn: PreparedChatTurn,
    openSessionHistory?: ChatMessage[],
    options?: AgentEngineTurnOptions,
  ): AsyncGenerator<StreamChunk>;
  cancel(): void;
  resetSession(): void;
  getSessionId(): string | null;
  rewind(checkpointId: string | null): Promise<ChatRewindResult>;
  consumeTurnMetadata(): ChatTurnMetadata;
  cleanup(): void;
}
