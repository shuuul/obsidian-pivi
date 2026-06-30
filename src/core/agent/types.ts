import type {
  InlineEditService,
  TitleGenerationService,
} from "../auxiliary/types";
import type { AgentHostContext } from "../bootstrap/hostContext";
import type { SharedAppStorage } from "../bootstrap/storage";
import type { McpServerManager } from "../mcp/McpServerManager";
import type { McpTestResult } from "../mcp/types";
import type { ChatRuntime } from "../runtime/ChatRuntime";
import type { LeafSummary } from "../session/types";
import type { FileStore, HomeFileStore } from "../storage/FileStore";
import type {
  AgentDefinition,
  ManagedMcpServer,
  McpAuthStatus,
  OpenSessionState,
  PluginInfo,
  SubagentInfo,
  ToolCallInfo,
} from "../types";
import type { ChatUIConfig } from "./chatUiTypes";
import type { SlashCommandCatalog } from "./commands/SlashCommandCatalog";

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
  reasoningControl: "effort" | "token-budget" | "none";
  planPathPrefix?: string;
}

export interface CreateChatRuntimeOptions {
  host: AgentHostContext;
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
  createTitleGenerationService: (
    host: AgentHostContext,
  ) => TitleGenerationService;
  createInlineEditService: (host: AgentHostContext) => InlineEditService;
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

/** Vault-local MCP OAuth (`.pivi/mcp-oauth/`). */
export interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}

export type AgentMentionSource = AgentDefinition["source"];

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

export type {
  ChatCompositeIconSvg,
  ChatIconSvg,
  ChatModeSelectorConfig,
  ChatPathIconSvg,
  ChatPermissionModeToggleConfig,
  ChatPiviBrandIconSvg,
  ChatReasoningOption,
  ChatSvgChild,
  ChatSvgGroupChild,
  ChatSvgPathChild,
  ChatUIConfig,
  ChatUIOption,
} from "./chatUiTypes";

export interface WorkspaceServices {
  settingsTabRenderer?: AgentSettingsTabRenderer | null;
  mcpStorage?: AppMcpStorage | null;
  mcpServerManager?: McpServerManager | null;
  mcpToolProvider?: AppMcpToolProvider | null;
  mcpServerProbeProvider?: AppMcpServerProbeProvider | null;
  mcpServerTester?: AppMcpServerTester | null;
  modelReadinessProvider?: AppModelReadinessProvider | null;
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

export interface AppMcpServerProbeResult {
  toolCount: number;
}

export interface AppMcpServerProbeProvider {
  testServer(serverName: string): Promise<AppMcpServerProbeResult>;
}

export interface AppMcpServerTester {
  testServer(server: ManagedMcpServer): Promise<McpTestResult>;
}

export type AppModelReadinessStatusKind =
  | "ready"
  | "missing-credential"
  | "oauth-expired"
  | "disabled"
  | "unavailable";

export interface AppModelReadinessStatus {
  kind: AppModelReadinessStatusKind;
  label: string;
  description: string;
}

export interface AppModelTestResult {
  ok: boolean;
  detail: string;
}

export interface AppModelReadinessProvider {
  getStatus(
    model: string,
    settings: Record<string, unknown>,
  ): AppModelReadinessStatus;
  testModel(
    model: string,
    settings: Record<string, unknown>,
  ): Promise<AppModelTestResult>;
}

export interface AppSkillSummary {
  name: string;
  description?: string;
}

export interface AppSkillProvider {
  listSkills(): AppSkillSummary[];
}

export interface AgentSettingsTabRendererContext {
  host: AgentHostContext;
  renderHiddenSlashCommandSetting(
    container: HTMLElement,
    copy: { name: string; desc: string; placeholder: string },
  ): void;
  refreshModelSelectors(): void;
  renderCustomContextLimits(container: HTMLElement): void;
  onEnvironmentChanged?(): void;
}

export interface AgentSettingsTabRenderer {
  renderSetup(
    container: HTMLElement,
    context: AgentSettingsTabRendererContext,
  ): void;
  renderModels(
    container: HTMLElement,
    context: AgentSettingsTabRendererContext,
  ): void;
  renderSkills(
    container: HTMLElement,
    context: AgentSettingsTabRendererContext,
  ): void;
}

export interface WorkspaceInitContext {
  host: AgentHostContext;
  storage: SharedAppStorage;
  vaultAdapter: FileStore;
  homeAdapter: HomeFileStore;
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
  resolveSessionIdForOpenSession(
    openSession: OpenSessionState | null,
  ): string | null;
  isPendingForkSession(openSession: OpenSessionState): boolean;
  /** Fork session tree to a new JSONL file at `atEntryId`. */
  forkSession?(
    openSession: OpenSessionState,
    atEntryId: string,
    vaultPath: string | null,
  ): Promise<{ sessionFile: string; leafId: string; sessionId: string } | null>;
  /** Adds adaptor-owned compatibility metadata to OpenSessionState.agentState before session save. */
  buildPersistedAgentState?(
    openSession: OpenSessionState,
  ): Record<string, unknown> | undefined;
  /** List all leaves (branches) in a session file. */
  listLeaves?(
    sessionFile: string,
    vaultPath: string | null,
  ): Promise<LeafSummary[]>;
}

export type TaskTerminalStatus = Extract<
  ToolCallInfo["status"],
  "completed" | "error"
>;

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

export type {
  InlineEditCursorRequest,
  InlineEditMode,
  InlineEditRequest,
  InlineEditResult,
  InlineEditSelectionRequest,
  InlineEditService,
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from "../auxiliary/types";
