import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import { OriginGrantRegistry } from "@pivi/agent/network";
import type { CapabilityApprovalPort } from "@pivi/agent/ports";
import type { OpenSessionState } from "@pivi/agent/runtime";
import type { SessionStore } from "@pivi/agent/session";
import { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { PiviSettings } from "@pivi/agent/settings";
import type { EnvironmentScope } from "@pivi/agent/settings/types";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import type { PiviManagementApprovalPort } from '@pivi/agent/tools/piviManagement';
import { PiSettingsCoordinator, warmPiAiModelsCache } from "@pivi/engine-pi/application/models";
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { installBundledFetch } from "@pivi/obsidian-host/bundledFetch";
import { createPiviNetworkClients } from "@pivi/obsidian-host/createPiviNetworkClients";
import { getVaultPath } from "@pivi/obsidian-host/path";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import type { ChatPerfRecorder } from "@pivi/pivi-react/store";
import type {
  Editor,
  MarkdownView,
  Plugin,
} from "obsidian";
import { apiVersion, Notice } from "obsidian";

import { ApplicationNoteToolbar } from "@/app/applicationNoteToolbar";
import { ApplicationSessions } from "@/app/applicationSessions";
import { type ChatPerfController, NOOP_CHAT_PERF_CONTROLLER } from "@/app/chatPerformanceController";
import { createDevelopmentSmokeRunner } from "@/app/developmentSmokeRunner";
import { ObsidianDeviceLocalCapabilityPermissionStore } from "@/app/deviceLocalCapabilityPermissionStore";
import { ObsidianDeviceLocalEnvironmentStore } from "@/app/deviceLocalEnvironmentStore";
import { ObsidianDeviceLocalExternalContextStore } from "@/app/deviceLocalExternalContextStore";
import { ObsidianDeviceLocalSessionJournalStore } from "@/app/deviceLocalSessionJournalStore";
import type { ChatFacade, PiviApplicationFacades, PiviChatView, SettingsFacade } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { openStyleSettingsOrMarketplace } from "@/app/openStyleSettings";
import {
  activatePiviView,
  canCreatePiviTab,
  ensurePiviViewOpen,
  openPiviNewTab,
} from "@/app/piviViewActivation";
import { initializePiviPlugin, shutdownOpenChatViews } from "@/app/pluginLifecycle";
import { loadPluginSettings } from "@/app/pluginSettingsLoad";
import { createPiUiFacades } from "@/app/runtime/piUiFacades";
import type { PiWorkspaceServices } from "@/app/runtime/PiWorkspaceServices";
import {
  createPluginServiceGraph,
  createSessionStore,
  createSharedStorage,
} from "@/app/serviceGraph";
import {
  applyEnvironmentVariablesBatch as applyEnvironmentVariablesBatchForPlugin,
  getActiveEnvironmentVariables as getActiveEnvironmentVariablesFromSettings,
  importEnvironmentText as importEnvironmentTextForPlugin,
  listEnvironmentUiEntries as listEnvironmentUiEntriesForPlugin,
} from "@/app/settings/environmentVariables";
import { measureStartupPhase } from "@/app/startupPerformance";
import { showDefaultVaultSkillsInstallPrompt } from "@/app/ui/defaultVaultSkillsPrompt";
import {
  findAllPiviViews,
  refreshPiviManagementViews,
  refreshVaultSkillsViews,
} from "@/app/viewAccess";
import { WorkspaceCommandRegistry } from "@/app/workspaceCommandRegistry";

const logger = new PluginLogger('PiviPlugin');
const DELETED_SESSION_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Product application and composition owner. Obsidian inheritance remains in
 * main.ts; this object owns all feature state and lifecycle behavior.
 */
export class PiviApplication {
  readonly plugin: Plugin;
  readonly facades: PiviApplicationFacades;
  readonly runDevelopmentRealHostSmoke: ChatFacade['runDevelopmentRealHostSmoke'];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.deviceLocalExternalContexts = new ObsidianDeviceLocalExternalContextStore(plugin.app);
    this.deviceLocalCapabilityPermissions = new ObsidianDeviceLocalCapabilityPermissionStore(plugin.app);
    this.deviceLocalEnvironmentStore = new ObsidianDeviceLocalEnvironmentStore(plugin.app);
    this.sessionManager = new OpenSessionManager({
      getVaultPath: () => getVaultPath(plugin.app),
      getStore: () => this.requireSessionStore(),
    });
    this.workspaceCommandRegistry = new WorkspaceCommandRegistry(this);
    this.uiFacades = createPiUiFacades(
      (providerId) => {
        const credential = this.piWorkspace?.credentialStore?.readSync(providerId);
        if (!credential || credential.type !== "api_key" || !("key" in credential)) {
          return undefined;
        }
        return typeof credential.key === "string" ? credential.key : undefined;
      },
      plugin.app.secretStorage,
    );
    this.sessionOperations = new ApplicationSessions({
      app: plugin.app,
      sessionManager: this.sessionManager,
      requireSessionStore: () => this.requireSessionStore(),
      getStorage: () => this.storage,
      getSettings: () => this.settings,
      getAllViews: () => this.getAllViews(),
    });
    this.noteToolbar = new ApplicationNoteToolbar({
      app: plugin.app,
      pluginId: plugin.manifest.id,
      processRunner: this.processRunner,
      getSettings: () => this.settings,
    });
    this.runDevelopmentRealHostSmoke = createDevelopmentSmokeRunner(this, {
      sessionManager: this.sessionManager,
      requireSessionStore: () => this.requireSessionStore(),
    });
    // The application satisfies each facade structurally; registrations see only
    // the members their facade type declares.
    this.facades = {
      chat: this,
      sessions: this.sessionOperations,
      workspace: this,
      integrations: this,
      settings: this,
    };
  }

  get app() { return this.plugin.app; }
  get manifest() { return this.plugin.manifest; }

  addCommand: Plugin['addCommand'] = (command) => this.plugin.addCommand(command);
  addRibbonIcon: Plugin['addRibbonIcon'] = (icon, title, callback) =>
    this.plugin.addRibbonIcon(icon, title, callback);
  addSettingTab: Plugin['addSettingTab'] = (tab) => this.plugin.addSettingTab(tab);
  register: Plugin['register'] = (callback) => this.plugin.register(callback);
  registerEditorExtension: Plugin['registerEditorExtension'] = (extension) =>
    this.plugin.registerEditorExtension(extension);
  registerEvent: Plugin['registerEvent'] = (eventRef) => this.plugin.registerEvent(eventRef);
  registerInterval: Plugin['registerInterval'] = (id) => this.plugin.registerInterval(id);
  registerView: Plugin['registerView'] = (type, creator) => this.plugin.registerView(type, creator);
  removeCommand: Plugin['removeCommand'] = (commandId) => this.plugin.removeCommand(commandId);
  declare settings: PiviSettings;
  readonly network = (() => {
    const clients = createPiviNetworkClients(new OriginGrantRegistry());
    installBundledFetch(clients.providerFetch);
    return clients;
  })();
  readonly httpClient = this.network.httpClient;
  readonly processRunner = systemProcessRunner;
  storage!: SharedAppStorage;
  private readonly deviceLocalExternalContexts: ObsidianDeviceLocalExternalContextStore;
  private readonly deviceLocalCapabilityPermissions: ObsidianDeviceLocalCapabilityPermissionStore;
  private readonly deviceLocalEnvironmentStore: ObsidianDeviceLocalEnvironmentStore;
  private readonly sessionManager: OpenSessionManager;
  private sessionStore: SessionStore | null = null;
  private piWorkspace: PiWorkspaceServices | null = null;
  private workspaceInitialization: Promise<PiWorkspaceServices> | null = null;
  private workspaceGeneration = 0;
  private isUnloading = false;
  private shutdownPromise: Promise<void> | null = null;
  private releaseSessionJournal: (() => boolean) | null = null;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private readonly workspaceCommandRegistry: WorkspaceCommandRegistry;
  private chatPerfController: ChatPerfController = NOOP_CHAT_PERF_CONTROLLER;
  private readonly uiFacades: ReturnType<typeof createPiUiFacades>;
  readonly sessionOperations: ApplicationSessions;
  readonly noteToolbar: ApplicationNoteToolbar;
  getVaultPath(): string | null {
    return getVaultPath(this.app);
  }

  getChatPerfController(): ChatPerfController {
    return this.chatPerfController;
  }

  getChatPerfRecorder(): ChatPerfRecorder {
    return this.chatPerfController;
  }

  notify(message: string | DocumentFragment, timeout?: number): Notice {
    return new Notice(message, timeout);
  }

  // Settings-facade members whose behavior lives in a collaborator.
  isNoteToolbarInstalled: SettingsFacade['isNoteToolbarInstalled'] = () => this.noteToolbar.isInstalled();
  setupNoteToolbarIntegration: SettingsFacade['setupNoteToolbarIntegration'] = style =>
    this.noteToolbar.setupSelectionCommand(style);
  purgeDeletedSessionFiles: SettingsFacade['purgeDeletedSessionFiles'] = () =>
    this.sessionOperations.purgeDeletedSessionFiles();
  purgeExpiredDeletedSessionFiles: SettingsFacade['purgeExpiredDeletedSessionFiles'] = () =>
    this.sessionOperations.purgeExpiredDeletedSessionFiles();
  loadSessionMaintenance: SettingsFacade['loadSessionMaintenance'] = () =>
    this.sessionOperations.loadSessionMaintenance();
  deleteAllArchivedChats: SettingsFacade['deleteAllArchivedChats'] = () =>
    this.sessionOperations.deleteAllArchivedChats();

  showDefaultVaultSkillsInstallPrompt = showDefaultVaultSkillsInstallPrompt;

  async openStyleSettings(): Promise<boolean> {
    return openStyleSettingsOrMarketplace(this.app);
  }

  async onload() {
    if (process.env.NODE_ENV !== 'production') {
      const { createChatPerfController } = await import('@/app/chatPerformanceRecorder');
      this.chatPerfController = createChatPerfController(
        this.app,
        this.manifest.version,
        apiVersion,
        window,
      );
    }
    await initializePiviPlugin(this.plugin, this.facades, () => this.loadSettings());
    await this.sessionOperations.purgeExpiredDeletedSessionFiles().catch((error: unknown) => {
      logger.warn('Failed to purge expired deleted sessions during startup', error);
    });
    this.registerInterval(window.setInterval(() => {
      void this.sessionOperations.purgeExpiredDeletedSessionFiles().catch((error: unknown) => {
        logger.warn('Failed to purge expired deleted sessions', error);
      });
    }, DELETED_SESSION_PURGE_INTERVAL_MS));
  }

  onunload(): void {
    void this.shutdown().catch((error: unknown) => {
      logger.error('Failed to shut down Pivi application', error);
    });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isUnloading = true;
    this.chatPerfController.dispose();
    this.workspaceGeneration += 1;
    this.workspaceCommandRegistry.clear();
    const persistence = shutdownOpenChatViews(this.app);
    const workspace = this.piWorkspace;
    const pendingInitialization = workspace ? null : this.workspaceInitialization;
    this.piWorkspace = null;
    this.shutdownPromise = this.finishShutdown(persistence, workspace, pendingInitialization);
    return this.shutdownPromise;
  }

  private async finishShutdown(
    persistence: Promise<void>,
    workspace: PiWorkspaceServices | null,
    pendingInitialization: Promise<PiWorkspaceServices> | null,
  ): Promise<void> {
    const errors: unknown[] = [];
    try {
      await persistence;
    } catch (error) {
      errors.push(error);
    }

    this.releaseSessionJournal?.();
    this.releaseSessionJournal = null;

    if (workspace) {
      try {
        await workspace.dispose();
      } catch (error) {
        errors.push(error);
      }
    } else if (pendingInitialization) {
      await pendingInitialization.catch(() => undefined);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Pivi application shutdown failed.');
    }
  }

  async activateView() {
    await activatePiviView(this.app, this.settings.chatViewPlacement);
  }

  canCreateNewTab(): boolean {
    return canCreatePiviTab(this.app);
  }

  async openNewTab(): Promise<void> {
    await openPiviNewTab(
      this.app,
      this.settings.chatViewPlacement,
      this.lastKnownTabManagerState,
    );
  }

  async addEditorSelectionToChatInput(
    editor: Editor,
    markdownView: MarkdownView,
  ): Promise<void> {
    const view = await ensurePiviViewOpen(this.app, this.settings.chatViewPlacement);
    const added = view?.getChatHandle()?.commands
      .addEditorSelection(editor, markdownView) ?? false;
    if (!added) {
      new Notice(t("chat.inlineContext.noActiveChatInput"));
      return;
    }

    new Notice(t("chat.inlineContext.selectionAdded"), 2000);
  }

  getAgentHostContext(): AgentHostContext {
    return {
      settings: this.settings,
      storage: this.storage,
      vaultPath: getVaultPath(this.app),
      sessionStore: this.sessionStore,
    };
  }

  private requireSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error("Session store is not initialized");
    }
    return this.sessionStore;
  }

  getUiFacades() {
    return this.uiFacades;
  }

  getCompactionRecoveryWarning = (): string => t('chat.errors.autoCompactionRecovery');

  getContinuationBlockedWarning = (): string => t('chat.errors.continuationBlocked');

  createChatService(options?: {
    capabilityApproval?: CapabilityApprovalPort | null;
    piviManagementApproval?: PiviManagementApprovalPort | null;
  }) {
    const workspace = this.piWorkspace;
    if (!workspace) {
      throw new Error("Pi workspace is not initialized");
    }
    return workspace.createChatService(this, this.httpClient, options);
  }

  createAuxQueryRunner() {
    const workspace = this.piWorkspace;
    if (!workspace) {
      throw new Error("Pi workspace is not initialized");
    }
    return workspace.createAuxQueryRunner(this);
  }

  async loadSettings() {
    this.storage = createSharedStorage(
      this.plugin,
      this.deviceLocalCapabilityPermissions,
    );
    await loadPluginSettings({
      app: this.app,
      storage: this.storage,
      sessionManager: this.sessionManager,
      createSessionStore: (vaultAdapter, vaultPath) =>
        createSessionStore(
          vaultAdapter,
          vaultPath,
          this.deviceLocalExternalContexts,
          new ObsidianDeviceLocalSessionJournalStore(this.app),
          (binding) => {
            this.releaseSessionJournal?.();
            this.releaseSessionJournal = () => binding.release();
          },
        ),
      persistSessionSummary: (openSession) =>
        this.sessionManager.persistSessionSummary(openSession),
      saveSettings: () => this.saveSettings(),
      setSettings: (settings) => {
        this.settings = settings;
      },
      setSessionStore: (store) => {
        this.sessionStore = store;
      },
      getSettings: () => this.settings,
      getSessions: () => this.sessionManager.getAll(),
      setLastKnownTabManagerState: (state) => {
        this.lastKnownTabManagerState = state as AppTabManagerState | null;
      },
      getStorage: () => this.storage,
      capabilityPermissions: this.deviceLocalCapabilityPermissions,
      legacyExternalContexts: this.deviceLocalExternalContexts,
      skillsHost: this,
    });
    this.network.setProviderDeadlines(this.settings.providerRequestDeadlines);
  }

  async saveSettings() {
    this.network.setProviderDeadlines(this.settings.providerRequestDeadlines);
    await this.storage.savePiviSettings(this.settings);
  }

  async applyEnvironmentVariables(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void> {
    await this.importEnvironmentText(scope, envText);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    await applyEnvironmentVariablesBatchForPlugin(this, updates, {
      persistSessionSummary: (openSession) =>
        this.sessionManager.persistSessionSummary(openSession),
      reconcileModelWithEnvironment: () => this.reconcileModelWithEnvironment(),
    });
  }

  async importEnvironmentText(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void> {
    await importEnvironmentTextForPlugin(this, scope, envText, {
      persistSessionSummary: (openSession) =>
        this.sessionManager.persistSessionSummary(openSession),
      reconcileModelWithEnvironment: () => this.reconcileModelWithEnvironment(),
    });
  }

  listEnvironmentEntries(scope?: EnvironmentScope) {
    return listEnvironmentUiEntriesForPlugin(this, scope);
  }

  getEnvironmentStore() {
    return this.deviceLocalEnvironmentStore;
  }

  getActiveEnvironmentVariables(): string {
    return getActiveEnvironmentVariablesFromSettings(this.settings);
  }

  private reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  } {
    return PiSettingsCoordinator.reconcileSettings(this.settings, this.sessionManager.getAll());
  }

  async loadTabManagerState(): Promise<AppTabManagerState | null> {
    return this.storage.getTabManagerState();
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    await this.storage.setTabManagerState(state);
    this.lastKnownTabManagerState = state;
  }

  getAllViews(): PiviChatView[] {
    return findAllPiviViews(this.app);
  }

  async refreshVaultSkills(): Promise<void> {
    await refreshVaultSkillsViews(this.getAllViews());
  }

  /**
   * Same-turn refresh after a durable Agent management commit.
   * Aggregates strict per-target failures from every view; never throws for partial refresh.
   */
  async refreshPiviManagement(
    domain: 'mcp' | 'skills' | 'commands' | 'prompt',
  ): Promise<readonly { readonly target: string; readonly message: string }[]> {
    return refreshPiviManagementViews(this.getAllViews(), domain);
  }

  ensureWorkspaceServices(): Promise<PiWorkspaceServices> {
    if (this.isUnloading) {
      return Promise.reject(new Error('Pivi plugin is unloading'));
    }
    if (this.piWorkspace) {
      return Promise.resolve(this.piWorkspace);
    }
    if (this.workspaceInitialization) {
      return this.workspaceInitialization;
    }

    const generation = this.workspaceGeneration;
    const initialization = measureStartupPhase(
      'workspace',
      () => createPluginServiceGraph({
        host: this.createWorkspaceRuntimeHost(),
        storage: this.storage,
        network: this.network,
      }),
    ).then(async (graph) => {
      if (generation !== this.workspaceGeneration) {
        await graph.piWorkspace.dispose();
        throw new Error('Pivi workspace initialization was cancelled');
      }
      this.piWorkspace = graph.piWorkspace;
      warmPiAiModelsCache();
      return graph.piWorkspace;
    });
    this.workspaceInitialization = initialization;
    void initialization.catch(() => {
      if (this.workspaceInitialization === initialization) {
        this.workspaceInitialization = null;
      }
    });
    return initialization;
  }

  reconcileWorkspaceCommandEntries(entries: readonly SlashCatalogEntry[]): void {
    if (this.isUnloading) return;
    this.workspaceCommandRegistry.reconcile(entries);
  }

  private createWorkspaceRuntimeHost() {
    const getSettings = () => this.settings;
    return {
      app: this.app,
      get settings() { return getSettings(); },
      registerEvent: (eventRef: Parameters<Plugin['registerEvent']>[0]) => this.plugin.registerEvent(eventRef),
      saveSettings: () => this.saveSettings(),
      reconcileWorkspaceCommandEntries: (entries: readonly SlashCatalogEntry[]) =>
        this.reconcileWorkspaceCommandEntries(entries),
      sessionRecovery: this.sessionOperations.sessionRecovery,
      refreshPiviManagement: (domain: 'mcp' | 'skills' | 'commands' | 'prompt') =>
        this.refreshPiviManagement(domain),
    };
  }
}

export interface PiviApplicationLifecycle {
  onload(): Promise<void>;
  onunload(): void;
  /** Awaitable completion hook for deterministic harnesses and lifecycle tests. */
  shutdown(): Promise<void>;
}

export function createPiviApplication(plugin: Plugin): PiviApplicationLifecycle {
  return new PiviApplication(plugin);
}
