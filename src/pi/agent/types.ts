import type {
  AgentDefinition,
  ManagedMcpServer,
  McpAuthStatus,
  SubagentInfo,
  ToolCallInfo,
} from "../../pi/types";
import type { AgentHostContext } from "../bootstrap/hostContext";
import type { SharedAppStorage } from "../bootstrap/storage";
import type { McpTestResult } from "../mcp/types";
import type { FileStore, HomeFileStore } from "../storage/FileStore";

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
// Pi workspace service interfaces
//
// These standalone app-facing types describe plugin-owned Pi workspace
// services. They are NOT part of the shared bootstrap storage contract
// (`SharedAppStorage`).
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
