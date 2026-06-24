import type ObsiusPlugin from '../../main';
import type { CursorContext } from '../../utils/editor';
import type { SharedAppStorage } from '../bootstrap/storage';
import type { McpServerManager } from '../mcp/McpServerManager';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { LeafSummary } from '../session/types';
import type { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  AgentDefinition,
  ManagedMcpServer,
  McpAuthStatus,
  OpenSessionState,
  PluginInfo,
  SubagentInfo,
  ToolCallInfo,
} from '../types';
import type { SlashCommandCatalog } from './commands/SlashCommandCatalog';

export interface RuntimeCapabilities {
  supportsPersistentRuntime: boolean;
  supportsNativeHistory: boolean;
  supportsPlanMode: boolean;
  supportsRewind: boolean;
  supportsFork: boolean;
  supportsRuntimeCommands: boolean;
  supportsImageAttachments: boolean;
  supportsMcpTools: boolean;
  supportsTurnSteer?: boolean;
  reasoningControl: 'effort' | 'token-budget' | 'none';
  planPathPrefix?: string;
}

export interface CreateChatRuntimeOptions {
  plugin: ObsiusPlugin;
}

/** Active agent registration bundle — wired once from `main.ts` via the runtime bootstrap. */
export interface AgentRegistration {
  displayName: string;
  capabilities: RuntimeCapabilities;
  environmentKeyPatterns?: RegExp[];
  chatUIConfig: ChatUIConfig;
  settingsPersistence: AgentSettingsPersistence;
  settingsReconciler: AgentSettingsReconciler;
  createRuntime: (options: CreateChatRuntimeOptions) => ChatRuntime;
  createTitleGenerationService: (plugin: ObsiusPlugin) => TitleGenerationService;
  createInlineEditService: (plugin: ObsiusPlugin) => InlineEditService;
  historyService: SessionHistoryService;
  taskResultInterpreter: TaskResultInterpreter;
  subagentLifecycleAdapter?: SubagentLifecycleAdapter;
}

export interface AgentSettingsReconciler {
  handleEnvironmentChange?(settings: Record<string, unknown>): boolean;

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    sessions: OpenSessionState[],
  ): { changed: boolean; invalidatedSessions: OpenSessionState[] };

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean;
}

export interface AgentSettingsPersistence {
  normalizeSettingsRecord(
    settings: Record<string, unknown>,
    source?: Record<string, unknown>,
  ): boolean;
  updateSettings(
    settings: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): void;
}

// ---------------------------------------------------------------------------
// App-level service interfaces
// ---------------------------------------------------------------------------

/** Tab manager state persisted across restarts. */
export interface AppTabManagerState {
  openTabs: Array<{
    tabId: string;
    sessionFile?: string | null;
    leafId?: string | null;
    draftModel?: string | null;
  }>;
  activeTabId: string | null;
}

// ---------------------------------------------------------------------------
// Workspace sub-interfaces (adaptor implements)
//
// These remain here as standalone types so app-level settings/chat code can
// depend on stable provider workspace contracts without importing concrete
// provider implementations. They are NOT part of the shared bootstrap storage
// contract (`SharedAppStorage`).
// ---------------------------------------------------------------------------

export interface AppMcpStorage {
  load(): Promise<ManagedMcpServer[]>;
  save(servers: ManagedMcpServer[]): Promise<void>;
  tryParseClipboardConfig?(text: string): unknown;
}

/** Vault-local MCP OAuth (`.obsius/mcp-oauth/`). */
export interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}

export type AgentMentionSource = AgentDefinition['source'];

export interface AgentMentionProvider {
  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: AgentMentionSource;
  }>;
}

/** Obsidian plugin manager interface consumed by the app layer. */
export interface AppPluginManager {
  loadPlugins(): Promise<void>;
  getPlugins(): PluginInfo[];
  hasPlugins(): boolean;
  hasEnabledPlugins(): boolean;
  getEnabledCount(): number;
  getPluginsKey(): string;
  togglePlugin(pluginId: string): Promise<void>;
  enablePlugin(pluginId: string): Promise<void>;
  disablePlugin(pluginId: string): Promise<void>;
}

/** Custom agent definitions manager consumed by the app layer. */
export interface AppAgentManager extends AgentMentionProvider {
  loadAgents(): Promise<void>;
  getAvailableAgents(): AgentDefinition[];
  getAgentById(id: string): AgentDefinition | undefined;
  searchAgents(query: string): AgentDefinition[];
  setBuiltinAgentNames(names: string[]): void;
}

// ---------------------------------------------------------------------------
// Chat UI configuration (agent adaptor implements ChatUIConfig)
// ---------------------------------------------------------------------------

/** Option for model, reasoning, or other UI selectors. */
export interface ChatUIOption {
  value: string;
  label: string;
  description?: string;
  /** Optional group label for visual separators in dropdowns. */
  group?: string;
  /** @lobehub/icons CDN slug for mask-based provider brand logo. */
  providerLogoSlug?: string;
  /** Lucide icon when no brand slug is available. */
  fallbackIcon?: string;
  /** Per-option icon override for grouped selector entries. */
  chatIcon?: ChatIconSvg;
}

export interface ChatPathIconSvg {
  kind?: 'path';
  viewBox: string;
  path: string;
}

export interface ChatSvgPathChild {
  tag: 'path';
  attributes: Record<string, string>;
}

export interface ChatSvgGroupChild {
  tag: 'g';
  attributes: Record<string, string>;
  children: ChatSvgPathChild[];
}

export type ChatSvgChild = ChatSvgGroupChild | ChatSvgPathChild;

export interface ChatCompositeIconSvg {
  kind: 'composite';
  viewBox: string;
  children: ChatSvgChild[];
}

/** Mask-based Obsius ring icon (matches ribbon `obsius-o` orientation). */
export interface ChatObsiusBrandIconSvg {
  kind: 'obsius-brand';
  viewBox: string;
}

/** SVG icon descriptor for chat toolbar and model selectors. */
export type ChatIconSvg = ChatPathIconSvg | ChatCompositeIconSvg | ChatObsiusBrandIconSvg;

/** Extended option with token count for budget-based reasoning controls. */
export interface ChatReasoningOption extends ChatUIOption {
  tokens?: number;
}

/** Compact permission-mode toggle descriptor for providers that expose the current toolbar control. */
export interface ChatPermissionModeToggleConfig {
  inactiveValue: string;
  inactiveLabel: string;
  activeValue: string;
  activeLabel: string;
  planValue?: string;
  planLabel?: string;
}

export interface ChatModeSelectorConfig {
  activeValue?: string;
  label: string;
  options: ChatUIOption[];
  value: string;
}

/** Static chat UI configuration implemented by the agent adaptor (models, reasoning, context window). */
export interface ChatUIConfig {
  /** Model options for the selector dropdown. Adaptor reads what it needs from the settings bag. */
  getModelOptions(settings: Record<string, unknown>): ChatUIOption[];

  /** Whether this adaptor recognizes the given model id. */
  ownsModel(model: string, settings: Record<string, unknown>): boolean;

  /** Whether the model uses adaptive reasoning (effort levels vs token budgets). */
  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean;

  /** Reasoning options for the current model (effort levels if adaptive, budgets otherwise). */
  getReasoningOptions(model: string, settings: Record<string, unknown>): ChatReasoningOption[];

  /** Default reasoning value for the model. */
  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string;

  /** Context window size in tokens. */
  getContextWindowSize(model: string, customLimits?: Record<string, number>): number;

  /** Whether this is a built-in (default) model vs custom/env model. */
  isDefaultModel(model: string): boolean;

  /** Apply model change side effects to settings (defaults, tracking). */
  applyModelDefaults(model: string, settings: unknown): void;

  /** Optional adaptor hook to discover model-scoped metadata after a model is selected. */
  prepareModelMetadata?(
    model: string,
    settings: Record<string, unknown>,
    context: { plugin: ObsiusPlugin },
  ): Promise<void>;

  /** Optional hook when the toolbar changes a reasoning selection. */
  applyReasoningSelection?(model: string, value: string, settings: unknown): void;

  /** Normalize model variant based on visibility flags. Adaptor reads what it needs from the settings bag. */
  normalizeModelVariant(model: string, settings: Record<string, unknown>): string;

  /** Extract custom model IDs from parsed environment variables. Used for per-model context limit UI. */
  getCustomModelIds(envVars: Record<string, string>): Set<string>;

  /** Optional permission-mode toggle descriptor. Return null when the adaptor exposes no permission toggle UI. */
  getPermissionModeToggle?(): ChatPermissionModeToggleConfig | null;

  /** Optional adaptor mapping back into the shared permission-mode contract. */
  resolvePermissionMode?(settings: Record<string, unknown>): string | null;

  /** Optional hook when the toolbar changes permission mode. */
  applyPermissionMode?(value: string, settings: unknown): void;

  /** Optional adaptor-owned mode selector descriptor. */
  getModeSelector?(settings: Record<string, unknown>): ChatModeSelectorConfig | null;

  /** Optional hook when the toolbar changes an adaptor-owned mode selection. */
  applyModeSelection?(value: string, settings: unknown): void;

  /** SVG icon for the chat UI (shown next to model names in selectors). */
  getChatIcon?(): ChatIconSvg | null;
}

export interface WorkspaceServices {
  settingsTabRenderer?: AgentSettingsTabRenderer | null;
  mcpStorage?: AppMcpStorage | null;
  mcpServerManager?: McpServerManager | null;
  mcpToolProvider?: AppMcpToolProvider | null;
  skillProvider?: AppSkillProvider | null;
  mcpOAuth?: AppMcpOAuth | null;
  slashCommandCatalog?: SlashCommandCatalog | null;
}

export interface AppMcpToolSummary {
  name: string;
  description?: string;
}

export interface AppMcpToolProvider {
  listTools(serverName: string): Promise<AppMcpToolSummary[]>;
}

export interface AppSkillSummary {
  name: string;
  description?: string;
}

export interface AppSkillProvider {
  listSkills(): AppSkillSummary[];
}

export interface AgentSettingsTabRendererContext {
  plugin: ObsiusPlugin;
  renderHiddenSlashCommandSetting(
    container: HTMLElement,
    copy: { name: string; desc: string; placeholder: string },
  ): void;
  refreshModelSelectors(): void;
  renderCustomContextLimits(container: HTMLElement): void;
}

export interface AgentSettingsTabRenderer {
  render(container: HTMLElement, context: AgentSettingsTabRendererContext): void;
}

export interface WorkspaceInitContext {
  plugin: ObsiusPlugin;
  storage: SharedAppStorage;
  vaultAdapter: VaultFileAdapter;
  homeAdapter: HomeFileAdapter;
}

export interface WorkspaceRegistration<
  TServices extends WorkspaceServices = WorkspaceServices,
> {
  initialize(context: WorkspaceInitContext): Promise<TServices>;
}

export interface SessionHistoryService {
  hydrateSessionHistory(
    openSession: OpenSessionState,
    vaultPath: string | null,
    leafId?: string | null,
  ): Promise<void>;
  deleteSessionFile(
    openSession: OpenSessionState,
    vaultPath: string | null,
  ): Promise<void>;
  resolveSessionIdForOpenSession(openSession: OpenSessionState | null): string | null;
  isPendingForkSession(openSession: OpenSessionState): boolean;
  /** Fork session tree to a new JSONL file at `atEntryId`. */
  forkSession?(
    openSession: OpenSessionState,
    atEntryId: string,
    vaultPath: string | null,
  ): Promise<{ sessionFile: string; leafId: string; sessionId: string } | null>;
  /** Adds adaptor-owned compatibility metadata to OpenSessionState.agentState before session save. */
  buildPersistedAgentState?(openSession: OpenSessionState): Record<string, unknown> | undefined;
  /** List all leaves (branches) in a session file. */
  listLeaves?(
    sessionFile: string,
    vaultPath: string | null,
  ): Promise<LeafSummary[]>;
}

export type TaskTerminalStatus = Extract<ToolCallInfo['status'], 'completed' | 'error'>;

export interface TaskResultInterpreter {
  hasAsyncLaunchMarker(toolUseResult: unknown): boolean;
  extractAgentId(toolUseResult: unknown): string | null;
  extractStructuredResult(toolUseResult: unknown): string | null;
  resolveTerminalStatus(
    toolUseResult: unknown,
    fallbackStatus: TaskTerminalStatus,
  ): TaskTerminalStatus;
  extractTagValue(payload: string, tagName: string): string | null;
}

export interface SubagentLaunchResult {
  agentId?: string;
  nickname?: string;
}

export interface SubagentWaitStatus {
  completed?: string;
  error?: string;
  failed?: string;
}

export interface SubagentWaitResult {
  statuses: Record<string, SubagentWaitStatus>;
  timedOut: boolean;
}

export interface SubagentLifecycleAdapter {
  isHiddenTool(name: string): boolean;
  isSpawnTool(name: string): boolean;
  isWaitTool(name: string): boolean;
  isCloseTool(name: string): boolean;
  resolveSpawnToolIds(
    waitToolCall: ToolCallInfo,
    agentIdToSpawnId: ReadonlyMap<string, string>,
  ): string[];
  buildSubagentInfo(
    spawnToolCall: ToolCallInfo,
    siblingToolCalls?: ToolCallInfo[],
  ): SubagentInfo;
  extractSpawnResult(raw: string | undefined): SubagentLaunchResult;
  extractWaitResult(raw: string | undefined): SubagentWaitResult;
}

// ---------------------------------------------------------------------------
// Auxiliary service contracts
// ---------------------------------------------------------------------------

// -- Title generation --

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  openSessionId: string,
  result: TitleGenerationResult
) => Promise<void>;

export interface TitleGenerationService {
  generateTitle(
    openSessionId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void>;
  cancel(): void;
}

// -- Inline edit --

export type InlineEditMode = 'selection' | 'cursor';

export interface InlineEditSelectionRequest {
  mode: 'selection';
  instruction: string;
  notePath: string;
  selectedText: string;
  startLine?: number;
  lineCount?: number;
  contextFiles?: string[];
}

export interface InlineEditCursorRequest {
  mode: 'cursor';
  instruction: string;
  notePath: string;
  cursorContext: CursorContext;
  contextFiles?: string[];
}

export type InlineEditRequest = InlineEditSelectionRequest | InlineEditCursorRequest;

export interface InlineEditResult {
  success: boolean;
  editedText?: string;
  insertedText?: string;
  clarification?: string;
  error?: string;
}

export interface InlineEditService {
  setModelOverride?(model?: string): void;
  resetSession(): void;
  editText(request: InlineEditRequest): Promise<InlineEditResult>;
  continueSession(message: string, contextFiles?: string[]): Promise<InlineEditResult>;
  cancel(): void;
}
