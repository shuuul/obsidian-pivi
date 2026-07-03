import type { EditorView } from '@codemirror/view';
import type {
  ChatMessage,
  ImageAttachment,
  SubagentInfo,
  ToolCallInfo,
  UsageInfo,
} from '@pivi/pivi-agent-core/foundation';
import type { ChatTurnRequest,PiTurnOptions } from '@pivi/pivi-agent-core/runtime';
import type { TodoItem, TodoVisualizationModel } from '@pivi/pivi-agent-core/tools';

import type { BrowserSelectionContext } from '../../shared/utils/browser';
import type { CanvasSelectionContext } from '../../shared/utils/canvas';
import type { EditorSelectionContext } from '../../shared/utils/editor';
import type { ThinkingBlockState } from '../rendering/ThinkingBlockRenderer';
// TODO(ui-package): migrate Write/Edit rendering state into @/ui.
import type { WriteEditState } from '../rendering/WriteEditRenderer';

/** Queued message waiting to be sent after current streaming completes. */
export interface QueuedMessage {
  content: string;
  images?: ImageAttachment[];
  editorContext: EditorSelectionContext | null;
  browserContext?: BrowserSelectionContext | null;
  canvasContext: CanvasSelectionContext | null;
  /** Provider-neutral turn snapshot captured at enqueue time. */
  turnRequest?: ChatTurnRequest;
}

/** Pending tool call waiting to be rendered (buffered until input is complete). */
export interface PendingToolCall {
  toolCall: ToolCallInfo;
  parentEl: HTMLElement | null;
}

/** Stored selection state from editor polling. */
export interface StoredSelection {
  notePath: string;
  selectedText: string;
  lineCount: number;
  startLine?: number;
  from?: number;
  to?: number;
  editorView?: EditorView;
  domRanges?: Range[];
}

/** Centralized chat state data. */
export interface ChatStateData {
  // Message state
  messages: ChatMessage[];

  // Streaming control
  isStreaming: boolean;
  cancelRequested: boolean;
  streamGeneration: number;
  /** Guards against concurrent operations during session creation. */
  isCreatingSession: boolean;
  /** Guards against concurrent operations during session switching. */
  isSwitchingSession: boolean;
  /** Local tab state is ahead of persisted session metadata. */
  hasPendingSessionSave: boolean;

  // Open session identity
  currentOpenSessionId: string | null;

  // Queued message
  queuedMessage: QueuedMessage | null;

  // Active streaming DOM state
  currentContentEl: HTMLElement | null;
  currentTextEl: HTMLElement | null;
  currentTextContent: string;
  currentThinkingState: ThinkingBlockState | null;
  thinkingEl: HTMLElement | null;
  queueIndicatorEl: HTMLElement | null;
  /** Debounce timeout for showing thinking indicator after inactivity. */
  thinkingIndicatorTimeout: number | null;

  // Tool tracking maps
  toolCallElements: Map<string, HTMLElement>;
  writeEditStates: Map<string, WriteEditState>;
  /** Pending tool calls buffered until input is complete (for non-streaming-style render). */
  pendingTools: Map<string, PendingToolCall>;

  // Context window usage
  usage: UsageInfo | null;
  // Flag to ignore usage updates (during session reset)
  ignoreUsageUpdates: boolean;

  // Current todo items for the persistent bottom panel
  currentTodos: TodoItem[] | null;
  currentTodoVisualizationModel: TodoVisualizationModel | null;

  // Attention state (approval pending, error, etc.)
  needsAttention: boolean;

  // Auto-scroll control during streaming
  autoScrollEnabled: boolean;

  // Response timer state
  responseStartTime: number | null;
  flavorTimerInterval: number | null;

  // Pending plan content for approve-new-session (auto-sends in new session after stream ends)
  pendingNewSessionPlan: string | null;

  // Plan file path captured from Write tool calls to provider plan directory during plan mode
  planFilePath: string | null;

  // Saved permission mode before entering plan mode (for Shift+Tab toggle restore)
  prePlanPermissionMode: string | null;
}

/** Callbacks for ChatState changes. */
export interface ChatStateCallbacks {
  onMessagesChanged?: () => void;
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onOpenSessionChanged?: (id: string | null) => void;
  onUsageChanged?: (usage: UsageInfo | null) => void;
  onTodosChanged?: (todos: TodoItem[] | null) => void;
  onTodoVisualizationChanged?: (model: TodoVisualizationModel | null) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onAutoScrollChanged?: (enabled: boolean) => void;
}

/** Options for query execution. */
export type QueryOptions = PiTurnOptions;

// Re-export types that are used across the chat feature
export type {
  ChatMessage,
  EditorSelectionContext,
  ImageAttachment,
  SubagentInfo,
  ThinkingBlockState,
  TodoItem,
  TodoVisualizationModel,
  ToolCallInfo,
  UsageInfo,
  WriteEditState,
};
