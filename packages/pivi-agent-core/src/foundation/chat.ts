import type { ToolUseResult } from './diff';
import type { SubagentMode, ToolCallInfo } from './tools';

/** Fork origin reference: identifies the source session and checkpoint. */
export interface ForkSource {
  sessionId: string;
  resumeAt: string;
}

/** View type identifier for Obsidian. */
export const VIEW_TYPE_PIVI = 'pivi-view';

/** Supported image media types for attachments. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Image attachment metadata. */
export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  /** Base64 encoded image data - single source of truth. */
  data: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}

/**
 * Serializable copy of the structured user request used to reproduce a turn.
 * Context-shaped fields stay unknown here to avoid a foundation -> context cycle.
 */
export interface ChatTurnRequestSnapshot {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  attachedFilePaths?: string[];
  editorSelection?: unknown;
  browserSelection?: unknown;
  canvasSelection?: unknown;
  inlineContexts?: unknown[];
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface CheckpointPresentation {
  artifacts: Array<{ label: string; vaultPath?: string }>;
  constraints: string[];
  continuationSummary: string;
  decisions: string[];
  goal: string | null;
  nextSteps: string[];
  openWork: string[];
  source: {
    firstEntryId: string;
    firstKeptEntryId: string;
    lastEntryId: string;
  };
  tokenEstimate: number;
  unresolvedQuestions: string[];
}

/** Content block for preserving streaming order in messages. */
export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolId: string }
  | { type: 'thinking'; content: string; durationSeconds?: number }
  | { type: 'subagent'; subagentId: string; mode?: SubagentMode }
  | {
      type: 'context_compacted';
      checkpoint?: CheckpointPresentation;
      summary?: string;
      tokensBefore?: number;
      tokensAfter?: number;
    };

/** Source that last set a session's visible title. */
export type SessionTitleSource = 'timestamp' | 'firstPrompt' | 'model' | 'custom';

/** Chat message with content, tool calls, and attachments. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Display-only content (e.g., "/tests" when content is the expanded prompt). */
  displayContent?: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  contentBlocks?: ContentBlock[];
  currentNote?: string;
  images?: ImageAttachment[];
  /**
   * Historical request snapshot for rendering and reproducing turn content.
   * Execution capabilities are recaptured from current UI/settings state.
   */
  turnRequest?: ChatTurnRequestSnapshot;
  /** True if this message represents a user interrupt (from SDK storage). */
  isInterrupt?: boolean;
  /** True if this message is rebuilt context sent to SDK on session reset (should be hidden). */
  isRebuiltContext?: boolean;
  /** Duration in seconds from user send to response completion. */
  durationSeconds?: number;
  /** Flavor word used for duration display (e.g., "Baked", "Cooked"). */
  durationFlavorWord?: string;
  /** JSONL parent entry id used for conversation rewind checkpoints. */
  parentEntryId?: string | null;
  /** JSONL user message entry id used for fork/rewind checkpoints. */
  userMessageId?: string;
  /** JSONL assistant message entry id used for fork checkpoints. */
  assistantMessageId?: string;
}

/** Persisted openSession with messages and session state. */
export interface OpenSessionState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Timestamp when the last agent response completed. */
  lastResponseAt?: number;
  sessionId: string | null;
  /** Vault-relative JSONL session file (SSOT). */
  sessionFile?: string;
  /** Active tree leaf entry id within `sessionFile`. */
  leafId?: string | null;
  /** Total number of branches (leaves) in this session. */
  leafCount?: number;
  /** Opaque agent-runtime state bag (session tracking, fork metadata, etc.). */
  agentState?: Record<string, unknown>;
  messages: ChatMessage[];
  /** Whether the in-memory UI projection omits older durable messages. */
  hasOlderMessages?: boolean;
  /** Durable projected-message count, including messages not loaded in memory. */
  totalMessageCount?: number;
  /** Durable projected-message count before the first loaded message. */
  olderMessageCount?: number;
  /** Durable user-message count before the first loaded message. */
  olderUserMessageCount?: number;
  /** Durable first-user preview, independent of the currently loaded page. */
  messagePreview?: string;
  currentNote?: string;
  /** Session-specific external context paths (directories with full access). Resets on new session. */
  externalContextPaths?: string[];
  /** Context window usage information. */
  usage?: UsageInfo;
  /** Source that last set the visible title. */
  titleSource?: SessionTitleSource;
  /** UI-enabled MCP servers for this session (context-saving servers activated via selector). */
  enabledMcpServers?: string[];
}

/** Lightweight session metadata for history/session lists. */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Timestamp when the last agent response completed. */
  lastResponseAt?: number;
  messageCount: number;
  preview: string;
  /** Source that last set the visible title. */
  titleSource?: SessionTitleSource;
  /** Vault-relative JSONL session file. */
  sessionFile?: string;
  /** Active tree leaf entry id within sessionFile. */
  leafId?: string | null;
  /** Total number of branches (leaves) in this session. */
  leafCount?: number;
}

/**
 * Normalized stream chunk emitted by the active provider runtime.
 *
 * All providers must emit: text, tool_use, tool_result, error, done, usage.
 * Provider-specific behavior must be normalized before reaching this contract.
 * Providers may keep provider-native turn metadata internally and expose it via
 * runtime methods instead of encoding it as stream-control chunks.
 */
export type StreamChunk =
  | { type: 'user_message_start'; content: string; itemId?: string }
  | { type: 'assistant_message_start'; itemId?: string }
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean; blocked?: boolean; toolUseResult?: ToolUseResult }
  | { type: 'tool_output'; id: string; content: string }
  | { type: 'error'; content: string }
  | { type: 'notice'; content: string; level?: 'info' | 'warning' }
  | {
      type: 'retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: 'retry_end';
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | { type: 'done' }
  | { type: 'usage'; usage: UsageInfo; sessionId?: string | null }
  | { type: 'context_compacting' }
  | {
      type: 'context_compacted';
      checkpoint?: CheckpointPresentation;
      summary?: string;
      tokensBefore?: number;
      tokensAfter?: number;
    }
  | { type: 'async_subagent_result'; agentId: string; subagentId?: string; status: 'completed' | 'error'; activityStatus?: 'cancelled'; result?: string }
  | { type: 'subagent_text'; subagentId: string; content: string }
  | { type: 'subagent_tool_use'; subagentId: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'subagent_tool_result'; subagentId: string; id: string; content: string; isError?: boolean; blocked?: boolean; toolUseResult?: ToolUseResult };

/**
 * Context window usage information.
 *
 * `contextTokens` is the complete active prompt-context count, never a
 * current-stream-segment count. Providers set it to their reported total
 * (input + cache tokens where applicable); temporary streaming updates use the
 * full locally estimated context envelope until authoritative usage arrives.
 *
 * Cache token fields are optional — only providers with prompt caching populate them.
 * Feature code should use `contextTokens` for display, not recompute from the cache breakdown.
 */
export interface ContextEnvelopeValue {
  source: 'estimated' | 'authoritative';
  tokens: number;
}

export interface ContextEnvelope {
  checkpoints: ContextEnvelopeValue;
  compactionReserve: ContextEnvelopeValue;
  contextWindow: ContextEnvelopeValue;
  recentConversation: ContextEnvelopeValue;
  reservedOutput: ContextEnvelopeValue;
  safetyMargin: ContextEnvelopeValue;
  selectedContext: ContextEnvelopeValue;
  system: ContextEnvelopeValue;
  toolAndAgentResults: ContextEnvelopeValue;
  total: ContextEnvelopeValue;
  /** Conservative trigger after both the configured ratio and reserved headroom. */
  compactionTriggerTokens: number;
  /** Sum of locally estimated input categories. */
  estimatedInputTokens: number;
  /** Current pressure uses the larger of provider and local estimates. */
  pressureInputTokens: number;
  /** Input capacity remaining after output, compaction, and safety reserves. */
  usableInputTokens: number;
}

export interface UsageInfo {
  model?: string;
  inputTokens: number;
  outputTokens?: number;
  outputTokenLimit?: number;
  /** Prompt caching: tokens used to create cache entries. Provider-specific; 0 if omitted. */
  cacheCreationInputTokens?: number;
  /** Prompt caching: tokens read from cache. Provider-specific; 0 if omitted. */
  cacheReadInputTokens?: number;
  /** Model context limit in tokens; 0 means the limit could not be determined. */
  contextWindow: number;
  /** True when `contextWindow` came from provider runtime data instead of a local heuristic. */
  contextWindowIsAuthoritative?: boolean;
  contextTokens: number;
  /** True only when the provider reported `contextTokens`; false/absent means estimated. */
  contextTokensIsAuthoritative?: boolean;
  contextEnvelope?: ContextEnvelope;
  percentage: number;
}
