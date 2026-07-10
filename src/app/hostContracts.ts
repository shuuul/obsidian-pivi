/**
 * Narrow UI-facing host contracts. Product UI depends on these shapes — not on
 * concrete PiviView or workspace implementation modules.
 */
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import type {
  AgentSettingsTabRenderer,
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
} from "@pivi/obsidian-host/serviceContracts";
import type { ProviderCredential } from "@pivi/pivi-agent-core/auth/piProviderCredentials";
import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from "@pivi/pivi-agent-core/foundation";
import type { ChatUIConfig, ChatUIOption } from "@pivi/pivi-agent-core/foundation/chatUi";
import type { EnvironmentScope, WebSearchProviderId } from "@pivi/pivi-agent-core/foundation/settings";
import type { ManagedMcpServer } from "@pivi/pivi-agent-core/mcp/types";
import type { HttpClient, ProcessRunner, SyncSecretStore } from "@pivi/pivi-agent-core/ports";
import type { AuxQueryRunner } from "@pivi/pivi-agent-core/runtime/auxQueryRunner";
import type { PiChatService } from "@pivi/pivi-agent-core/runtime/piChatService";
import type { LeafSummary } from "@pivi/pivi-agent-core/session";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

/** Minimal active-tab surface used by host consumers (inline edit, commands). */
export interface PiviChatActiveTab {
  draftModel: string | null;
  service: PiChatService | null;
  serviceInitialized: boolean;
  openSessionId: string | null;
  sessionFile: string | null;
  state: { isStreaming: boolean };
  ui: {
    inlineContextManager: {
      addSelectionFromEditor(editor: unknown, markdownView: unknown): boolean;
    } | null;
    externalContextSelector: {
      getExternalContexts(): string[];
    } | null;
  };
  controllers: {
    inputController: { cancelStreaming(): void } | null;
    openSessionController: {
      createNew(options?: { force?: boolean }): Promise<unknown>;
    } | null;
  };
}

/** Tab list item returned by tab managers (settings restart / session delete). */
export type PiviChatTabSurface = PiviChatActiveTab & {
  id: string;
};

/** Minimal tab-manager surface used across app/settings and multi-view ops. */
export interface PiviChatTabManagerSurface {
  canCreateTab(): boolean;
  switchToTab(tabId: string): Promise<void>;
  getAllTabs(): ReadonlyArray<PiviChatTabSurface>;
  broadcastToAllTabs(
    fn: (service: PiChatService) => void | Promise<void>,
  ): Promise<void>;
  invalidateSlashCommandCaches(): void;
}

/**
 * Minimal chat view surface. Host contracts depend on this — not on concrete
 * `PiviView` from product UI (breaks the type-level app ↔ ui cycle).
 */
export interface PiviChatView {
  leaf: WorkspaceLeaf;
  refreshModelSelector(): void;
  invalidateSlashCommandCaches(): void;
  updateLayoutForPosition(): void;
  createNewTab(): Promise<void>;
  getActiveTab(): PiviChatActiveTab | null;
  getTabManager(): PiviChatTabManagerSurface | null;
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
  listProviderIdsSync(): string[];
  modify(
    providerId: string,
    fn: (current: ProviderCredential | undefined) => Promise<ProviderCredential | undefined>,
  ): Promise<ProviderCredential | undefined>;
  delete(providerId: string): Promise<void>;
}

export interface PiviProviderOAuth {
  hasCodexAuth(): boolean;
  loginCodex(onProgress?: (message: string) => void): Promise<void>;
  logoutCodex(): void;
}

export interface PiviWebSearchCredentialStore {
  readSync(providerId: WebSearchProviderId): string | undefined;
  writeSync(providerId: WebSearchProviderId, apiKey: string): void;
  clearSync(providerId: WebSearchProviderId): void;
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

  /** Move legacy env/file provider secrets into Obsidian keychain. */
  migrateProviderCredentialsToKeychain(
    secretStorage: SyncSecretStore,
    addedProviders: readonly string[],
    environmentVariables: string,
  ): {
    addedProviders: string[];
    environmentVariables: string;
    changed: boolean;
  };
}

/** Workspace services exposed to chat/settings UI by the Obsidian plugin shell. */
export interface PiviPluginWorkspace {
  settingsTabRenderer: AgentSettingsTabRenderer;
  mcpStorage: AppMcpStorage;
  mcpServerManager: PiviMcpServerManager;
  mcpToolProvider: AppMcpToolProvider;
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

/** Shared host capabilities needed by chat and settings UI. */
export interface PiviHostCore {
  app: App;
  settings: PiviSettings;
  storage: SharedAppStorage;
  httpClient: HttpClient;
  processRunner: ProcessRunner;

  saveSettings(): Promise<void>;
  getAgentHostContext(): AgentHostContext;
  getVaultPath(): string | null;
  getPiWorkspace(): PiviPluginWorkspace | null;
  getUiFacades(): PiviUiFacades;
}

/** Chat-facing host: sessions, runtime factories, views. */
export interface PiviChatHost extends PiviHostCore {
  createChatService(): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
  getView(): PiviChatView | null;
  getAllViews(): PiviChatView[];
  getOpenSessionById(
    id: string,
    leafId?: string | null,
  ): Promise<OpenSessionState | null>;
  getOpenSessionSync(id: string): OpenSessionState | null;
  getSessionList(): SessionSummary[];
  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState>;
  openSessionByFile(
    sessionFile: string,
    leafId?: string | null,
  ): Promise<OpenSessionState>;
  switchSession(
    id: string,
    leafId?: string | null,
  ): Promise<OpenSessionState | null>;
  deleteSession(id: string): Promise<void>;
  purgeDeletedSessionFiles(): Promise<number>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  listSessionLeaves(sessionFile: string): Promise<LeafSummary[]>;
  forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
  findSessionAcrossViews(
    openSessionId: string,
  ): { view: PiviChatView; tabId: string } | null;
  persistTabManagerState(state: AppTabManagerState): Promise<void>;
}

/** Settings-facing host: environment, model refresh, workspace probes. */
export interface PiviSettingsHost extends PiviHostCore {
  getAllViews(): PiviChatView[];
  getView(): PiviChatView | null;
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
  /**
   * Optional Notice helper used by environment apply and skills prompts.
   * Compatible with Obsidian Notice and package vault-skills notifier.
   */
  notify?(
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
    PiviChatHost,
    PiviSettingsHost {
  settings: PiviSettings;
}

export type { PiviPluginHost as default, PiviPluginHost as PiviPlugin };
