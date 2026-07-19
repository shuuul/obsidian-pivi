import type { EditorView } from '@codemirror/view';
import type { BrowserSelectionContext } from '@pivi/pivi-agent-core/context/browser';
import type { CanvasSelectionContext } from '@pivi/pivi-agent-core/context/canvas';
import type { EditorSelectionContext } from '@pivi/pivi-agent-core/context/editor';
import type {
  ChatMessage,
  ImageAttachment,
  SubagentInfo,
  ToolCallInfo,
  UsageInfo,
} from '@pivi/pivi-agent-core/foundation';
import type { ChatTurnRequest, PiTurnOptions } from '@pivi/pivi-agent-core/runtime';
import type { TodoItem, TodoVisualizationModel } from '@pivi/pivi-agent-core/tools';

/** Queued message waiting to be sent after current streaming completes. */
export interface QueuedMessage {
  id: string;
  content: string;
  images?: ImageAttachment[];
  editorContext: EditorSelectionContext | null;
  browserContext?: BrowserSelectionContext | null;
  canvasContext: CanvasSelectionContext | null;
  /** Provider-neutral turn snapshot captured at enqueue time. */
  turnRequest?: ChatTurnRequest;
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
  hasOlderMessages: boolean;
  totalMessageCount: number;
  olderMessageCount: number;
  /** Number of durable user messages before the first loaded message. */
  olderUserMessageCount: number;

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

  // Queued messages
  queuedMessages: QueuedMessage[];

  // Active streaming presentation state
  currentTextContent: string;

  // Context window usage
  usage: UsageInfo | null;
  // Flag to ignore usage updates (during session reset)
  ignoreUsageUpdates: boolean;

  // Current todo items for the persistent bottom panel
  currentTodos: TodoItem[] | null;
  currentTodoVisualizationModel: TodoVisualizationModel | null;

  // Attention state (inline prompt, error, etc.)
  needsAttention: boolean;

  // Auto-scroll control during streaming
  autoScrollEnabled: boolean;

  // Response timer state
  responseStartTime: number | null;
  welcomeGreeting: string | null;
  navigationVisible: boolean;
}


/** Callbacks for ChatState changes that still have Tab/TabManager consumers. */
export interface ChatStateCallbacks {
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onOpenSessionChanged?: (id: string | null) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
}

/** Options for query execution. */
export type QueryOptions = PiTurnOptions;

export type {
  ChatMessage,
  EditorSelectionContext,
  ImageAttachment,
  SubagentInfo,
  TodoItem,
  TodoVisualizationModel,
  ToolCallInfo,
  UsageInfo,
};
