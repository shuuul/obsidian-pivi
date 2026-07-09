/**
 * Narrow UI-facing host contracts. Product UI depends on these shapes — not on
 * concrete PiviView or workspace implementation modules.
 */
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import type {
  AgentSettingsTabRenderer,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
} from "@pivi/obsidian-host/serviceContracts";
import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import type { ObsidianCredentialStore } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import type { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/piProviderOAuthService";
import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from "@pivi/pivi-agent-core/foundation";
import type { EnvironmentScope } from "@pivi/pivi-agent-core/foundation/settings";
import type { McpServerManager } from "@pivi/pivi-agent-core/mcp/mcpServerManager";
import type { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import type { HttpClient, ProcessRunner } from "@pivi/pivi-agent-core/ports";
import type { AuxQueryRunner } from "@pivi/pivi-agent-core/runtime/auxQueryRunner";
import type { PiChatService } from "@pivi/pivi-agent-core/runtime/piChatService";
import type { LeafSummary } from "@pivi/pivi-agent-core/session";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { WebSearchCredentialStore } from "@pivi/pivi-agent-core/tools";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import type { ChatRuntimeServiceFactories } from "./workspace/createChatRuntimeServices";
import type { PiUiFacades } from "./workspace/piUiFacades";

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

/** Workspace services exposed to chat/settings UI by the Obsidian plugin shell. */
export interface PiviPluginWorkspace extends ChatRuntimeServiceFactories {
  settingsTabRenderer: AgentSettingsTabRenderer;
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService | null;
  providerOAuth?: ProviderOAuthService;
  credentialStore?: ObsidianCredentialStore | null;
  webSearchCredentialStore?: WebSearchCredentialStore | null;
  slashCommandCatalog: SlashCommandCatalog;
  baseToolProvider: PiBaseToolProvider;
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
  getUiFacades(): PiUiFacades;
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
  renameSession(id: string, title: string): Promise<void>;
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
