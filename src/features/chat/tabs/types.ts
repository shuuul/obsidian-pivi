import type { Component, WorkspaceLeaf } from 'obsidian';

import type { TitleGenerationService } from '../../../core/agent/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { InputController } from '../controllers/InputController';
import type { NavigationController } from '../controllers/NavigationController';
import type { SelectionController } from '../controllers/SelectionController';
import type { SessionController } from '../controllers/SessionController';
import type { StreamController } from '../controllers/StreamController';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { InlineContextManager } from '../ui/InlineContext';
import type { InputSendButton } from '../ui/InputSendButton';
import type {
  ContextUsageMeter,
  ExternalContextSelector,
  McpServerSelector,
  ModelSelector,
  ModeSelector,
  PermissionToggle,
  ThinkingBudgetSelector,
} from '../ui/InputToolbar';
import type { NavigationSidebar } from '../ui/NavigationSidebar';
import type { RichChatInput } from '../ui/RichChatInput';
import type { StatusPanel } from '../ui/StatusPanel';

/**
 * Default number of tabs allowed.
 *
 * Set to 3 to balance usability with resource usage:
 * - Each tab has its own chat runtime and persistent query
 * - More tabs = more memory and potential SDK processes
 * - 3 tabs allows multi-tasking without excessive overhead
 */
export const DEFAULT_MAX_TABS = 3;

/**
 * Minimum number of tabs allowed (settings floor).
 */
export const MIN_TABS = 3;

/**
 * Maximum number of tabs allowed (settings ceiling).
 * Users can configure up to this many tabs via settings.
 */
export const MAX_TABS = 10;

/**
 * Minimal interface for the ObsiusView methods used by TabManager and Tab.
 * Extends Component for Obsidian integration (event handling, cleanup).
 * Avoids circular dependency by not importing ObsiusView directly.
 */
export interface TabManagerViewHost extends Component {
  /** Reference to the workspace leaf for revealing the view. */
  leaf: WorkspaceLeaf;

  /** Gets the tab manager instance (used for cross-view coordination). */
  getTabManager(): TabManagerInterface | null;
}

/**
 * Minimal interface for TabManager methods used by external code.
 * Used to break circular dependencies.
 */
export interface TabManagerInterface {
  /** Switches to a specific tab. */
  switchToTab(tabId: TabId): Promise<void>;

  /** Gets all tabs. */
  getAllTabs(): TabData[];
}

/** Tab identifier type. */
export type TabId = string;

/** Generates a unique tab ID. */
export function generateTabId(): TabId {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Controllers managed per-tab.
 * Each tab has its own set of controllers for independent operation.
 */
export interface TabControllers {
  selectionController: SelectionController | null;
  browserSelectionController: BrowserSelectionController | null;
  canvasSelectionController: CanvasSelectionController | null;
  openSessionController: SessionController | null;
  streamController: StreamController | null;
  inputController: InputController | null;
  navigationController: NavigationController | null;
}

/**
 * Services managed per-tab.
 */
export interface TabServices {
  subagentManager: SubagentManager;

  titleGenerationService: TitleGenerationService | null;
}

/**
 * UI components managed per-tab.
 */
export interface TabUIComponents {
  fileContextManager: FileContextManager | null;
  inlineContextManager: InlineContextManager | null;
  imageContextManager: ImageContextManager | null;
  modelSelector: ModelSelector | null;
  modeSelector: ModeSelector | null;
  thinkingBudgetSelector: ThinkingBudgetSelector | null;
  externalContextSelector: ExternalContextSelector | null;
  mcpServerSelector: McpServerSelector | null;
  permissionToggle: PermissionToggle | null;
  slashCommandDropdown: SlashCommandDropdown | null;
  contextUsageMeter: ContextUsageMeter | null;
  sendButton: InputSendButton | null;
  statusPanel: StatusPanel | null;
  navigationSidebar: NavigationSidebar | null;
}

/**
 * DOM elements managed per-tab.
 */
export interface TabDOMElements {
  contentEl: HTMLElement;
  messagesWrapperEl: HTMLElement;
  messagesEl: HTMLElement;
  messagesBottomControlsEl: HTMLElement;
  welcomeEl: HTMLElement | null;

  /** Container for status panel overlay at the bottom of the messages area. */
  statusPanelContainerEl: HTMLElement;

  inputContainerEl: HTMLElement;
  queueIndicatorEl: HTMLElement;
  inputWrapper: HTMLElement;
  richInput: RichChatInput;

  /** Legacy nav row placeholder for tab badges and header icons. */
  navRowEl: HTMLElement;

  /** Context row for file chips and selection indicator (inside input wrapper). */
  contextRowEl: HTMLElement;

  selectionIndicatorEl: HTMLElement | null;
  browserIndicatorEl: HTMLElement | null;
  canvasIndicatorEl: HTMLElement | null;

  /** Cleanup functions for event listeners (prevents memory leaks). */
  eventCleanups: Array<() => void>;
}

/**
 * Tab lifecycle states:
 * - `blank`: No openSession binding, no runtime. Draft model selection only.
 * - `bound_cold`: Bound to a openSession, but runtime not started yet.
 * - `bound_active`: Bound to a openSession with a running runtime.
 * - `closing`: Tab is being torn down.
 */
export type TabLifecycleState = 'blank' | 'bound_cold' | 'bound_active' | 'closing';

/**
 * Represents a single tab in the multi-tab system.
 * Each tab is an independent chat session with its own runtime instance.
 */
export interface TabData {
  /** Unique tab identifier. */
  id: TabId;

  /** Explicit lifecycle state. */
  lifecycleState: TabLifecycleState;

  /**
   * Draft model selected in a blank tab (before first send).
   * Used to derive provider on first send. Null after binding.
   */
  draftModel: string | null;

  /** Open session ID bound to this tab (null for new/empty tabs). */
  openSessionId: string | null;

  /** Vault-relative JSONL session file. */
  sessionFile: string | null;

  /** Active leaf within the session tree. */
  leafId: string | null;

  /** Per-tab chat runtime instance for independent streaming. */
  service: ChatRuntime | null;

  /** Whether the service has been initialized (lazy start). */
  serviceInitialized: boolean;

  /** Per-tab chat state. */
  state: ChatState;

  /** Per-tab controllers. */
  controllers: TabControllers;

  /** Per-tab services. */
  services: TabServices;

  /** Per-tab UI components. */
  ui: TabUIComponents;

  /** Per-tab DOM elements. */
  dom: TabDOMElements;

  /** Per-tab renderer. */
  renderer: MessageRenderer | null;
}

export type TabAgentContext = Pick<TabData, 'openSessionId' | 'service' | 'lifecycleState' | 'draftModel'>;

/**
 * Persisted tab state for restoration on plugin reload.
 */
export interface PersistedTabState {
  tabId: TabId;
  sessionFile?: string | null;
  leafId?: string | null;
  draftModel?: string | null;
}

/**
 * Tab manager state persisted to data.json.
 */
export interface PersistedTabManagerState {
  openTabs: PersistedTabState[];
  activeTabId: TabId | null;
}

/**
 * Callbacks for tab state changes.
 */
export interface TabManagerCallbacks {
  /** Called when a tab is created. */
  onTabCreated?: (tab: TabData) => void;

  /** Called when switching to a different tab. */
  onTabSwitched?: (fromTabId: TabId | null, toTabId: TabId) => void;

  /** Called when a tab is closed. */
  onTabClosed?: (tabId: TabId) => void;

  /** Called when tab streaming state changes. */
  onTabStreamingChanged?: (tabId: TabId, isStreaming: boolean) => void;

  /** Called when tab title changes. */
  onTabTitleChanged?: (tabId: TabId, title: string) => void;

  /** Called when tab attention state changes (approval pending, etc.). */
  onTabAttentionChanged?: (tabId: TabId, needsAttention: boolean) => void;

  /** Called when a tab's session changes (loaded different openSession in same tab). */
  onTabSessionChanged?: (tabId: TabId, openSessionId: string | null) => void;
}

/**
 * Tab bar item representation for rendering.
 */
export interface TabBarItem {
  id: TabId;
  /** 1-based index for display. */
  index: number;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
}
