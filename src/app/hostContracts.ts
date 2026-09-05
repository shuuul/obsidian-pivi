/**
 * Narrow UI-facing host contracts. Product UI depends on these shapes — not on
 * concrete PiviViewHost or workspace implementation modules.
 */
import type { ProviderCredential } from "@pivi/agent/auth/piProviderCredentials";
import type { ProviderOAuthProgress } from "@pivi/agent/auth/providerOAuthProgress";
import type { McpManagementCoordinator } from "@pivi/agent/mcp/mcpManagementCoordinator";
import type {
  AppMcpDiagnostics,
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
} from "@pivi/agent/mcp/ports";
import type { ManagedMcpServer } from "@pivi/agent/mcp/types";
import type { HttpClient, ProcessRunner } from "@pivi/agent/ports";
import type { CapabilityApprovalPort } from "@pivi/agent/ports";
import type { OpenSessionState, SessionSummary } from "@pivi/agent/runtime";
import type { AuxQueryRunner } from "@pivi/agent/runtime/auxQueryRunner";
import type { ChatUIConfig, ChatUIOption } from "@pivi/agent/runtime/chatUi";
import type { PiChatService } from "@pivi/agent/runtime/piChatService";
import type { SessionMessagePage, SessionRecoveryPort } from "@pivi/agent/session";
import type { PiviSettings } from "@pivi/agent/settings";
import type {
  DeviceLocalEnvironmentStore,
  EnvironmentUiEntry,
} from "@pivi/agent/settings/deviceLocalEnvironmentState";
import type {
  AppModelReadinessProvider,
} from "@pivi/agent/settings/modelReadiness";
import type { EnvironmentScope, WebProviderId } from "@pivi/agent/settings/types";
import type { SlashCommandCatalog } from "@pivi/agent/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import type { AppSkillProvider } from "@pivi/agent/skills/skillProvider";
import type { SkillsManagementCoordinator } from "@pivi/agent/skills/vault/skillsManagementCoordinator";
import type { PiviManagementApprovalPort } from "@pivi/agent/tools/piviManagement";
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import type { ChatPerfRecorder } from "@pivi/pivi-react/store";
import type {
  App,
  Editor,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

import type { ChatPerfController } from "@/app/chatPerformanceController";
import type {
  NoteToolbarItemStyle,
  NoteToolbarSetupResult,
} from "@/app/noteToolbarIntegration";


export interface PiviChatViewCommandState {
  mounted: boolean;
  canCreateTab: boolean;
  canStartNewSession: boolean;
  canCloseActiveTab: boolean;
}

export interface PiviRealHostSmokeRequest {
  version: 1;
  operation: 'run' | 'inspect' | 'cleanup';
  runId: string;
  notePath: string;
  ledgerPath: string;
  sessionFile?: string;
  openSessionId?: string;
}

export interface PiviRealHostSmokeSnapshot {
  version: 1;
  runId: string;
  notePath: string;
  ledgerPath: string;
  sessionFile: string;
  openSessionId: string;
  noteContent: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    toolCalls: Array<{
      id: string;
      name: string;
      status: string;
      result: string;
    }>;
  }>;
}

export type PiviRealHostSmokeResult = PiviRealHostSmokeSnapshot | {
  version: 1;
  runId: string;
  cleaned: true;
};

/** User-command capabilities. No tab, controller, runtime, or DOM graph escapes. */
export interface PiviChatViewCommands {
  getState(): PiviChatViewCommandState;
  createTab(): Promise<boolean>;
  startNewSession(): Promise<boolean>;
  openSession(openSessionId: string): Promise<boolean>;
  closeActiveTab(): Promise<boolean>;
  cancelActiveTurn(): boolean;
  addEditorSelection(editor: Editor, markdownView: MarkdownView): boolean;
  sendWorkspaceCommandInNewSession(content: string): Promise<boolean>;
  submitInlineEditTurn(params: {
    content: string;
    model?: string;
    thinkingLevel?: string;
    draftTitle?: string;
    onAssistantText?: (accumulatedText: string) => void;
    registerCancel?: (cancel: () => void) => void;
  }): Promise<{ assistantText: string; tabId: string } | null>;
  getActiveExternalContexts(): string[];
}

/** Bounded, sanitized per-target failure from a management refresh pass. */
export interface PiviManagementRefreshFailure {
  readonly target: string;
  readonly message: string;
}

/** App-owned maintenance operations over all tabs in one mounted view. */
export interface PiviChatViewMaintenance {
  persistState(): Promise<void>;
  /** Persists bindings, cancels active work, saves sessions, and releases view runtimes. */
  shutdown(): Promise<void>;
  resetSession(openSessionId: string): Promise<void>;
  getBoundSessionFiles(): string[];
  hasSession(openSessionId: string): boolean;
  activateSession(openSessionId: string): Promise<boolean>;
  refreshModelPresentation(): void;
  refreshTabBarPosition(): void;
  refreshChatDisplaySettings(): void;
  refreshRuntimePrompt(): Promise<void>;
  reloadMcpServers(): Promise<void>;
  refreshVaultSkills(): Promise<void>;
  /**
   * Strict same-turn refresh after a durable Agent management commit.
   * Iterates initialized tabs directly and returns sanitized per-target failures
   * instead of swallowing them via best-effort broadcast.
   */
  refreshPiviManagement(domain: 'mcp' | 'skills' | 'commands' | 'prompt'): Promise<readonly PiviManagementRefreshFailure[]>;
  invalidateSlashCatalog(): void;
  warmSlashCatalog(): void;
  syncExternalReadDirectories(paths: readonly string[]): void;
  applyEnvironmentRuntimeChange(modelChanged: boolean): Promise<{ failedTabs: number }>;
  markFileContextDirty(includesFolders: boolean): void;
  handleFileOpen(file: TFile): void;
  dismissMentionDropdown(target: Node): void;
}

/** Development-only deterministic workload controls, absent from production bundles. */
export interface PiviChatDevelopmentCommands {
  runRealHostSmoke?(request: PiviRealHostSmokeRequest): Promise<PiviRealHostSmokeResult>;
  run20SubagentsWorkload(hooks: {
    afterRender(result: { subagents: number; messages: number }): Promise<void>;
  }): Promise<{
    subagents: number;
    messages: number;
  }>;
  runIndexedSessionPagingWorkload(hooks: {
    afterColdOpen(): Promise<void>;
    afterOlderPage(): Promise<void>;
  }): Promise<{
    initialMessages: number;
    messagesAfterPrepend: number;
  }>;
  runProjectionWorkload?(
    workload: 'nested-subagent' | 'small-text' | 'tool-heavy',
    hooks: {
      beforeMeasurement(result: {
        workload: 'nested-subagent' | 'small-text' | 'tool-heavy';
        fixtureSha256: string;
        warmupEvents: number;
        sampleEvents: number;
      }): Promise<void>;
      afterMeasurement(result: {
        workload: 'nested-subagent' | 'small-text' | 'tool-heavy';
        fixtureSha256: string;
        warmupEvents: number;
        sampleEvents: number;
      }): Promise<void>;
    },
  ): Promise<{
    workload: 'nested-subagent' | 'small-text' | 'tool-heavy';
    fixtureSha256: string;
    warmupEvents: number;
    sampleEvents: number;
  }>;
  run100KbMarkdownStream(): Promise<{
    bytes: number;
    chunks: number;
    durationMs: number;
  }>;
  runTabSwitchingWorkload(): Promise<{
    tabs: number;
    switches: number;
    durationMs: number;
  }>;
}

/** Stable semantic boundary between the app shell and chat product runtime. */
export interface PiviChatViewHandle {
  commands: PiviChatViewCommands;
  maintenance: PiviChatViewMaintenance;
  development?: PiviChatDevelopmentCommands;
}

/**
 * Minimal chat view surface. Host contracts depend on this — not on concrete
 * `PiviViewHost` from product UI (breaks the type-level app ↔ ui cycle).
 */
export interface PiviChatView {
  leaf: WorkspaceLeaf;
  getChatHandle(): PiviChatViewHandle | null;
}

export interface PiviMcpAvailabilitySummary {
  totalCount: number;
  enabledCount: number;
  alwaysActiveCount: number;
  contextSavingCount: number;
}

export interface PiviMcpServerManager {
  getServers(): ManagedMcpServer[];
  getContextSavingServers(): ManagedMcpServer[];
  getAvailabilitySummary(): PiviMcpAvailabilitySummary;
}

export interface PiviProviderCredentialStore {
  readSync(providerId: string): ProviderCredential | undefined;
  modify(
    providerId: string,
    fn: (current: ProviderCredential | undefined) => Promise<ProviderCredential | undefined>,
  ): Promise<ProviderCredential | undefined>;
  delete(providerId: string): Promise<void>;
}

export interface PiviProviderOAuth {
  hasCodexAuth(): boolean;
  hasProviderOAuth(providerId: string): boolean;
  loginProviderOAuth(
    providerId: string,
    onProgress?: (progress: ProviderOAuthProgress) => void,
  ): Promise<void>;
  cancelProviderOAuthLogin(providerId: string): void;
  logoutProviderOAuth(providerId: string): Promise<void>;
}

export interface PiviWebSearchCredentialStore {
  readSync(providerId: WebProviderId): string | undefined;
  writeSync(providerId: WebProviderId, apiKey: string): void;
  clearSync(providerId: WebProviderId): void;
}

export interface PiviUiFacades {
  /** Chat toolbar/settings model-selector configuration. */
  readonly chatUIConfig: ChatUIConfig;

  /** Project active model/reasoning fields onto a settings snapshot. */
  getSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T;

  /** Write a settings snapshot back into durable settings. */
  commitSettingsSnapshot(
    settings: Record<string, unknown>,
    snapshot: Record<string, unknown>,
  ): void;

  /** List catalog models for one provider (settings checklist). */
  listModelsForProvider(
    providerId: string,
    customContextLimits?: Readonly<Record<string, number>>,
  ): ChatUIOption[];

  /** List built-in catalog models, excluding configured custom providers. */
  listCatalogModels(settings: Record<string, unknown>): ChatUIOption[];

  /** Reinstall custom/local providers from settings into the pi-ai registry. */
  syncCustomProviders(settings: Record<string, unknown>): void;

  /** Fetch remote model list for a custom/local provider and persist it. */
  fetchCustomProviderModels(
    providerId: string,
    settings: Record<string, unknown>,
  ): Promise<{ count: number }>;

}

/** Workspace services exposed to chat/settings UI by the Obsidian plugin shell. */
export interface PiviPluginWorkspace {
  mcpStorage: AppMcpStorage;
  mcpManagement: McpManagementCoordinator;
  mcpServerManager: PiviMcpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpDiagnostics: AppMcpDiagnostics;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  skillsManagement: SkillsManagementCoordinator;
  mcpOAuth: AppMcpOAuth | null;
  providerOAuth?: PiviProviderOAuth;
  credentialStore?: PiviProviderCredentialStore | null;
  webSearchCredentialStore?: PiviWebSearchCredentialStore | null;
  slashCommandCatalog: SlashCommandCatalog;
}

/**
 * Shared host capabilities needed by chat and settings UI.
 * Wide composition fields (workspace, storage, HTTP, process) stay off this
 * surface so chat UI cannot depend on them — use ChatPorts / SettingsPorts.
 */
export interface PiviHostCore {
  app: App;
  settings: PiviSettings;

  saveSettings(): Promise<void>;
  getAgentHostContext(): AgentHostContext;
  getVaultPath(): string | null;
  getUiFacades(): PiviUiFacades;
}

/** Chat-runtime host. Every other capability must arrive through `ChatPorts`. */
export interface PiviChatHost {
  app: App;
}

/** Composition-only chat capabilities; never pass this contract into `src/ui`. */
export interface PiviChatCompositionHost extends PiviHostCore {
  getAllViews(): PiviChatView[];
  loadTabManagerState(): Promise<AppTabManagerState | null>;
  persistTabManagerState(state: AppTabManagerState): Promise<void>;
  runDevelopmentRealHostSmoke?(
    request: PiviRealHostSmokeRequest,
  ): Promise<PiviRealHostSmokeResult>;
}

/**
 * Settings/composition host: environment, model refresh, and wide capabilities
 * used by `createUiPorts` / main (not by `src/ui` chat code).
 */
export interface PiviSettingsHost extends PiviHostCore {
  storage: SharedAppStorage;
  httpClient: HttpClient;
  processRunner: ProcessRunner;
  getAllViews(): PiviChatView[];
  refreshVaultSkills(): Promise<void>;
  /** Opens Style Settings, or its community-plugin page when unavailable. */
  openStyleSettings(): Promise<boolean>;
  /** Checks for Note Toolbar's installed manifest without requiring it to be enabled. */
  isNoteToolbarInstalled(): Promise<boolean>;
  /** Configures the Pivi command in Note Toolbar's selected-text toolbar. */
  setupNoteToolbarIntegration(
    itemStyle: NoteToolbarItemStyle,
  ): Promise<NoteToolbarSetupResult>;
  setupWorkspaceCommandNoteToolbar(entry: SlashCatalogEntry): Promise<NoteToolbarSetupResult>;
  reconcileWorkspaceCommands(): Promise<void>;
  /** Session-file cleanup action exposed from the session-files settings section. */
  purgeDeletedSessionFiles(): Promise<number>;
  purgeExpiredDeletedSessionFiles(): Promise<number>;
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  importEnvironmentText(scope: EnvironmentScope, envText: string): Promise<void>;
  listEnvironmentEntries(scope?: EnvironmentScope): readonly EnvironmentUiEntry[];
  getEnvironmentStore(): DeviceLocalEnvironmentStore;
  /** Obsidian Notice adapter used for timely settings and workspace feedback. */
  notify(
    message: string | DocumentFragment,
    timeout?: number,
  ): { noticeEl: HTMLElement; hide(): void } | null;
}

/** Chat behavior consumed by command registration and chat-view composition. */
export interface ChatFacade extends PiviChatCompositionHost {
  getChatPerfController(): ChatPerfController;
  getChatPerfRecorder(): ChatPerfRecorder;
  createChatService(options?: {
    capabilityApproval?: CapabilityApprovalPort | null;
    piviManagementApproval?: PiviManagementApprovalPort | null;
  }): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
  activateView(): Promise<void>;
  canCreateNewTab(): boolean;
  openNewTab(): Promise<void>;
  addEditorSelectionToChatInput(editor: Editor, markdownView: MarkdownView): Promise<void>;
}

export interface SessionsFacade {
  getSessionList(): SessionSummary[];
  getOpenSessionSync(id: string): OpenSessionState | null;
  getOpenSessionById(id: string): Promise<OpenSessionState | null>;
  openRecentSessionMessages(id: string, limit: number): Promise<SessionMessagePage | null>;
  readOlderSessionMessages(id: string, beforeEntryId: string, limit: number): Promise<SessionMessagePage | null>;
  createOpenSession(options?: { sessionId?: string; sessionFile?: string }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  deleteSessionFile(sessionFile: string, id?: string | null): Promise<void>;
  discardSessionFile(sessionFile: string, id?: string | null): Promise<void>;
  renameSession(id: string, title: string, titleSource?: OpenSessionState['titleSource']): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  forkSessionAt(openSession: OpenSessionState, atEntryId: string): Promise<{ sessionFile: string; sessionId: string } | null>;
  purgeDeletedSessionFiles(): Promise<number>;
  purgeExpiredDeletedSessionFiles(): Promise<number>;
  readonly sessionRecovery: SessionRecoveryPort;
}

export interface WorkspaceFacade {
  app: App;
  ensureWorkspaceServices(): Promise<PiviPluginWorkspace>;
  getAllViews(): PiviChatView[];
  refreshPiviManagement(domain: 'mcp' | 'skills' | 'commands' | 'prompt'): Promise<readonly PiviManagementRefreshFailure[]>;
}

export interface IntegrationsFacade {
  app: App;
  settings: PiviSettings;
  readonly manifest: { readonly id: string };
  getUiFacades(): PiviUiFacades;
  ensureWorkspaceServices(): Promise<PiviPluginWorkspace>;
  addEditorSelectionToChatInput(editor: Editor, markdownView: MarkdownView): Promise<void>;
}

export type SettingsFacade = PiviSettingsHost;

export interface PiviApplicationFacades {
  chat: ChatFacade;
  sessions: SessionsFacade;
  workspace: WorkspaceFacade;
  integrations: IntegrationsFacade;
  settings: SettingsFacade;
}
