import type { EditorView } from '@codemirror/view';
import type { BrowserSelectionContext } from '@pivi/agent/context/browser';
import type { CanvasSelectionContext } from '@pivi/agent/context/canvas';
import type { EditorSelectionContext } from '@pivi/agent/context/editor';
import type {
  ChatMessage,
  ImageAttachment,
  SubagentInfo,
  ToolCallInfo,
  UsageInfo,
} from '@pivi/agent/foundation';
import type { ChatTurnRequest } from '@pivi/agent/runtime';
import type { TodoItem, TodoVisualizationModel } from '@pivi/agent/tools';

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
  showCacheHitRate: boolean;
  showTokensPerSecond: boolean;

  // Response timer state
  responseStartTime: number | null;
  welcomeGreeting: string | null;
  navigationVisible: boolean;
}

export function createInitialChatStateData(): ChatStateData {
  return {
    messages: [],
    hasOlderMessages: false,
    totalMessageCount: 0,
    olderMessageCount: 0,
    olderUserMessageCount: 0,
    isStreaming: false,
    cancelRequested: false,
    streamGeneration: 0,
    isCreatingSession: false,
    isSwitchingSession: false,
    hasPendingSessionSave: false,
    currentOpenSessionId: null,
    queuedMessages: [],
    currentTextContent: '',
    usage: null,
    ignoreUsageUpdates: false,
    currentTodos: null,
    currentTodoVisualizationModel: null,
    needsAttention: false,
    autoScrollEnabled: true,
    showCacheHitRate: true,
    showTokensPerSecond: true,
    responseStartTime: null,
    welcomeGreeting: null,
    navigationVisible: false,
  };
}


/** Callbacks for ChatState changes that still have Tab/TabManager consumers. */
export interface ChatStateCallbacks {
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onOpenSessionChanged?: (id: string | null) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
}

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
