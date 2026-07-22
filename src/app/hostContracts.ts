/**
 * Narrow UI-facing host contracts. Product UI depends on these shapes — not on
 * concrete PiviViewHost or workspace implementation modules.
 */
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import type { ProviderCredential } from "@pivi/pivi-agent-core/auth/piProviderCredentials";
import type { ProviderOAuthProgress } from "@pivi/pivi-agent-core/auth/providerOAuthProgress";
import type { PiviSettings } from "@pivi/pivi-agent-core/foundation";
import type { ChatUIConfig, ChatUIOption } from "@pivi/pivi-agent-core/foundation/chatUi";
import type {
  AppModelReadinessProvider,
} from "@pivi/pivi-agent-core/foundation/modelReadiness";
import type { EnvironmentScope, WebProviderId } from "@pivi/pivi-agent-core/foundation/settings";
import type {
  AppMcpDiagnostics,
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
} from "@pivi/pivi-agent-core/mcp/ports";
import type { ManagedMcpServer } from "@pivi/pivi-agent-core/mcp/types";
import type { HttpClient, ProcessRunner } from "@pivi/pivi-agent-core/ports";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";
import type { AppSkillProvider } from "@pivi/pivi-agent-core/skills/skillProvider";
import type {
  App,
  Editor,
  MarkdownView,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

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

/** User-command capabilities. No tab, controller, runtime, or DOM graph escapes. */
export interface PiviChatViewCommands {
  getState(): PiviChatViewCommandState;
  createTab(): Promise<boolean>;
  startNewSession(): Promise<boolean>;
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

/** App-owned maintenance operations over all tabs in one mounted view. */
export interface PiviChatViewMaintenance {
  persistState(): Promise<void>;
  resetSession(openSessionId: string): Promise<void>;
  getBoundSessionFiles(): string[];
  hasSession(openSessionId: string): boolean;
  activateSession(openSessionId: string): Promise<boolean>;
  refreshModelPresentation(): void;
  refreshTabBarPosition(): void;
  refreshRuntimePrompt(): Promise<void>;
  reloadMcpServers(): Promise<void>;
  refreshVaultSkills(): Promise<void>;
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
  listModelsForProvider(providerId: string): ChatUIOption[];

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
  mcpServerManager: PiviMcpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpDiagnostics: AppMcpDiagnostics;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
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
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  /** Obsidian Notice adapter used for timely settings and workspace feedback. */
  notify(
    message: string | DocumentFragment,
    timeout?: number,
  ): { noticeEl: HTMLElement; hide(): void } | null;
}

/**
 * Full plugin host surface (chat + settings). Implemented by the Obsidian
 * Plugin class. `settings` is Pivi-typed and overrides Plugin's looser field.
 */
export interface PiviPluginHost
  extends Omit<Plugin, "settings">,
    PiviChatCompositionHost,
    PiviSettingsHost {
  settings: PiviSettings;
}

export type { PiviPluginHost as default, PiviPluginHost as PiviPlugin };
