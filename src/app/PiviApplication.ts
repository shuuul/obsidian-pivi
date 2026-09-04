/* eslint-disable max-lines -- Application composition remains cohesive; feature behavior stays in scoped collaborators. */
import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import { OriginGrantRegistry } from "@pivi/agent/network";
import type { CapabilityApprovalPort } from "@pivi/agent/ports";
import type { OpenSessionState, SessionSummary } from "@pivi/agent/runtime";
import type { SessionMessagePage, SessionStore } from "@pivi/agent/session";
import { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { PiviSettings } from "@pivi/agent/settings";
import type { EnvironmentScope } from "@pivi/agent/settings/types";
import { getObsidianToolsSettingsFromBag } from "@pivi/agent/settings/types";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import type { PiviManagementApprovalPort } from '@pivi/agent/tools/piviManagement';
import { PiSettingsCoordinator, warmPiAiModelsCache } from "@pivi/engine-pi/application/models";
import { ObsidianVaultApi } from "@pivi/obsidian-host";
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { installBundledFetch } from "@pivi/obsidian-host/bundledFetch";
import { ObsidianCliTransport } from "@pivi/obsidian-host/cli/obsidianCliTransport";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import { createPiviNetworkClients } from "@pivi/obsidian-host/createPiviNetworkClients";
import { openExternalUrl } from "@pivi/obsidian-host/openExternalUrl";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import type { ChatPerfRecorder } from "@pivi/pivi-react/store";
import type { Editor, MarkdownView, Plugin } from "obsidian";
import { apiVersion, getIcon, Notice } from "obsidian";

import {
  type ChatPerfController,
  NOOP_CHAT_PERF_CONTROLLER,
} from "@/app/chatPerformanceController";
import { ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID } from "@/app/commandRegistration";
import { ObsidianDeviceLocalEnvironmentStore } from "@/app/deviceLocalEnvironmentStore";
import { ObsidianDeviceLocalExternalContextStore } from "@/app/deviceLocalExternalContextStore";
import { ObsidianDeviceLocalSessionJournalStore } from "@/app/deviceLocalSessionJournalStore";
import type {
  ChatFacade,
  IntegrationsFacade,
  PiviApplicationFacades,
  PiviChatView,
  SessionsFacade,
  SettingsFacade,
  WorkspaceFacade,
} from "@/app/hostContracts";
import { getVaultPath } from "@/app/hostPlatform";
import { t } from "@/app/i18n";
import {
  getInstalledPluginVersion,
  isNoteToolbarInstalled,
  isPluginEnabled,
  type NoteToolbarItemApi,
  type NoteToolbarItemStyle,
  type NoteToolbarSetupQueue,
  type NoteToolbarSetupResult,
  runQueuedNoteToolbarRequest,
  runQueuedNoteToolbarSetup,
  setupNoteToolbarIntegration as setupNoteToolbar,
} from "@/app/noteToolbarIntegration";
import { openStyleSettingsOrMarketplace } from "@/app/openStyleSettings";
import {
  activatePiviView,
  canCreatePiviTab,
  ensurePiviViewOpen,
  openPiviNewTab,
} from "@/app/piviViewActivation";
import { initializePiviPlugin, persistOpenTabStates } from "@/app/pluginLifecycle";
import * as sessionApi from "@/app/pluginSessionApi";
import { loadPluginSettings } from "@/app/pluginSettingsLoad";
import { createPiUiFacades } from "@/app/runtime/piUiFacades";
import type { PiWorkspaceServices } from "@/app/runtime/PiWorkspaceServices";
import {
  createPluginServiceGraph,
  createSessionStore,
  createSharedStorage,
} from "@/app/serviceGraph";
import { readSessionTranscript } from "@/app/sessionTranscript";
import {
  applyEnvironmentVariablesBatch as applyEnvironmentVariablesBatchForPlugin,
  getActiveEnvironmentVariables as getActiveEnvironmentVariablesFromSettings,
  getEnvironmentVariablesForScope as getEnvironmentVariablesForSettingsScope,
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
import {
  getWorkspaceCommandFullId,
  WorkspaceCommandRegistry,
} from "@/app/workspaceCommandRegistry";

const logger = new PluginLogger('PiviPlugin');
const DELETED_SESSION_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Product application and composition owner. Obsidian inheritance remains in
 * main.ts; this object owns all feature state and lifecycle behavior.
 */
export class PiviApplication {
  readonly plugin: Plugin;
  readonly facades: PiviApplicationFacades;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.deviceLocalExternalContexts = new ObsidianDeviceLocalExternalContextStore(plugin.app);
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
    const getSettings = () => this.settings;
    const chat: ChatFacade = {
      app: this.app,
      get settings() { return getSettings(); },
      saveSettings: () => this.saveSettings(),
      getAgentHostContext: () => this.getAgentHostContext(),
      getVaultPath: () => this.getVaultPath(),
      getUiFacades: () => this.getUiFacades(),
      getAllViews: () => this.getAllViews(),
      loadTabManagerState: () => this.loadTabManagerState(),
      persistTabManagerState: state => this.persistTabManagerState(state),
      getChatPerfController: () => this.getChatPerfController(),
      getChatPerfRecorder: () => this.getChatPerfRecorder(),
      createChatService: options => this.createChatService(options),
      createAuxQueryRunner: () => this.createAuxQueryRunner(),
      activateView: () => this.activateView(),
      canCreateNewTab: () => this.canCreateNewTab(),
      openNewTab: () => this.openNewTab(),
      addEditorSelectionToChatInput: (editor, view) => this.addEditorSelectionToChatInput(editor, view),
    };
    const sessions: SessionsFacade = {
      getSessionList: () => this.getSessionList(),
      getOpenSessionSync: id => this.getOpenSessionSync(id),
      getOpenSessionById: id => this.getOpenSessionById(id),
      openRecentSessionMessages: (id, limit) => this.openRecentSessionMessages(id, limit),
      readOlderSessionMessages: (id, before, limit) => this.readOlderSessionMessages(id, before, limit),
      createOpenSession: options => this.createOpenSession(options),
      openSessionByFile: file => this.openSessionByFile(file),
      deleteSession: id => this.deleteSession(id),
      deleteSessionFile: (file, id) => this.deleteSessionFile(file, id),
      renameSession: (id, title, source) => this.renameSession(id, title, source),
      updateSession: (id, updates) => this.updateSession(id, updates),
      forkSessionAt: (session, entry) => this.forkSessionAt(session, entry),
      purgeDeletedSessionFiles: () => this.purgeDeletedSessionFiles(),
      purgeExpiredDeletedSessionFiles: () => this.purgeExpiredDeletedSessionFiles(),
      sessionRecovery: this.sessionRecovery,
    };
    const workspace: WorkspaceFacade = {
      app: this.app,
      ensureWorkspaceServices: () => this.ensureWorkspaceServices(),
      getAllViews: () => this.getAllViews(),
      refreshPiviManagement: domain => this.refreshPiviManagement(domain),
    };
    const integrations: IntegrationsFacade = {
      app: this.app,
      get settings() { return getSettings(); },
      manifest: this.manifest,
      getUiFacades: () => this.getUiFacades(),
      ensureWorkspaceServices: () => this.ensureWorkspaceServices(),
      addEditorSelectionToChatInput: (editor, view) => this.addEditorSelectionToChatInput(editor, view),
    };
    const settings: SettingsFacade = {
      app: this.app,
      get settings() { return getSettings(); },
      saveSettings: () => this.saveSettings(),
      getAgentHostContext: () => this.getAgentHostContext(),
      getVaultPath: () => this.getVaultPath(),
      getUiFacades: () => this.getUiFacades(),
      get storage() { return getStorage(); },
      httpClient: this.httpClient,
      processRunner: this.processRunner,
      getAllViews: () => this.getAllViews(),
      refreshVaultSkills: () => this.refreshVaultSkills(),
      openStyleSettings: () => this.openStyleSettings(),
      isNoteToolbarInstalled: () => this.isNoteToolbarInstalled(),
      setupNoteToolbarIntegration: style => this.setupNoteToolbarIntegration(style),
      setupWorkspaceCommandNoteToolbar: entry => this.setupWorkspaceCommandNoteToolbar(entry),
      reconcileWorkspaceCommands: () => this.reconcileWorkspaceCommands(),
      purgeDeletedSessionFiles: () => this.purgeDeletedSessionFiles(),
      purgeExpiredDeletedSessionFiles: () => this.purgeExpiredDeletedSessionFiles(),
      getActiveEnvironmentVariables: () => this.getActiveEnvironmentVariables(),
      getEnvironmentVariablesForScope: scope => this.getEnvironmentVariablesForScope(scope),
      applyEnvironmentVariables: (scope, text) => this.applyEnvironmentVariables(scope, text),
      applyEnvironmentVariablesBatch: updates => this.applyEnvironmentVariablesBatch(updates),
      importEnvironmentText: (scope, text) => this.importEnvironmentText(scope, text),
      listEnvironmentEntries: scope => this.listEnvironmentEntries(scope),
      getEnvironmentStore: () => this.getEnvironmentStore(),
      notify: (message, timeout) => this.notify(message, timeout),
    };
    const getStorage = () => this.storage;
    this.facades = { chat, sessions, workspace, integrations, settings };
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
  private readonly deviceLocalEnvironmentStore: ObsidianDeviceLocalEnvironmentStore;
  private readonly sessionManager: OpenSessionManager;
  private deletedSessionOperationTail: Promise<void> = Promise.resolve();
  private sessionStore: SessionStore | null = null;
  private piWorkspace: PiWorkspaceServices | null = null;
  private workspaceInitialization: Promise<PiWorkspaceServices> | null = null;
  private workspaceGeneration = 0;
  private isUnloading = false;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private readonly noteToolbarSetupQueue: NoteToolbarSetupQueue = { active: null };
  private readonly workspaceCommandRegistry: WorkspaceCommandRegistry;
  private chatPerfController: ChatPerfController = NOOP_CHAT_PERF_CONTROLLER;
  private readonly uiFacades: ReturnType<typeof createPiUiFacades>;
  readonly sessionRecovery = {
    read: async (sessionFile: string) => {
      const summary = this.sessions.find((session) => session.sessionFile === sessionFile);
      if (!summary) throw new Error(`Session not found: ${sessionFile}`);
      return readSessionTranscript({
        sessionFile,
        store: this.requireSessionStore(),
      });
    },
    listDeleted: () => this.runDeletedSessionOperation(() => sessionApi.listDeletedSessions(
      this.sessionContext(),
      this.settings.deletedSessionRetentionDays,
    )),
    restore: (sessionFile: string) => this.runDeletedSessionOperation(async () => {
      const restored = await sessionApi.restoreDeletedSession(
        this.sessionContext(),
        sessionFile,
        async (openSession) => {
          const view = await ensurePiviViewOpen(this.app, this.settings.chatViewPlacement);
          const opened = await view?.getChatHandle()?.commands.openSession(openSession.id) ?? false;
          if (!opened) throw new Error('Restored session could not be opened in a Pivi tab.');
        },
      );
      return {
        sessionId: restored.id,
        title: restored.title,
        sessionFile: restored.sessionFile ?? sessionFile,
      };
    }),
  };

  private runDeletedSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.deletedSessionOperationTail.then(operation, operation);
    this.deletedSessionOperationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  getVaultPath(): string | null {
    return getVaultPath(this.app);
  }

  /** Host-neutral vault adapter used by Obsidian tools and automation hooks. */
  createVaultApi(): ObsidianVaultApi {
    return new ObsidianVaultApi(this.app);
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

  showDefaultVaultSkillsInstallPrompt = showDefaultVaultSkillsInstallPrompt;

  async openStyleSettings(): Promise<boolean> {
    return openStyleSettingsOrMarketplace(this.app);
  }

  async setupNoteToolbarIntegration(
    itemStyle: NoteToolbarItemStyle,
  ): Promise<NoteToolbarSetupResult> {
    return runQueuedNoteToolbarSetup(
      this.noteToolbarSetupQueue,
      itemStyle,
      async (style) => {
        const toolSettings = getObsidianToolsSettingsFromBag(this.settings);
        const cli = new ObsidianCliTransport(toolSettings, {
          processRunner: this.processRunner,
          vaultPath: getVaultPath(this.app),
        });
        return setupNoteToolbar({
          adapter: this.app.vault.adapter,
          apiVersion,
          cliAvailable:
            toolSettings.cliEnabled && isOfficialObsidianCliEnabled(),
          commandId: `${this.manifest.id}:${ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID}`,
          configDir: this.app.vault.configDir,
          itemStyle: style,
          itemTooltip: t("settings.noteToolbar.itemTooltip"),
          getItemApi: (itemId) => this.getNoteToolbarItemApi(itemId),
          getInstalledPluginVersion: (pluginId) =>
            getInstalledPluginVersion(this.app, pluginId),
          isPluginEnabled: (pluginId) => isPluginEnabled(this.app, pluginId),
          openUri: openExternalUrl,
          runCli: (args) =>
            cli.run({ vaultName: this.app.vault.getName(), args }),
        });
      },
    );
  }

  isNoteToolbarInstalled(): Promise<boolean> {
    return Promise.resolve(
      isNoteToolbarInstalled((pluginId) =>
        getInstalledPluginVersion(this.app, pluginId),
      ),
    );
  }

  async setupWorkspaceCommandNoteToolbar(
    entry: SlashCatalogEntry,
  ): Promise<NoteToolbarSetupResult> {
    if (!entry.integrationKey) {
      throw new Error(`Workspace command /${entry.name} has no integration key`);
    }
    await this.reconcileWorkspaceCommands();
    const icon = entry.icon && getIcon(entry.icon) ? entry.icon : 'message-square';
    const key = `${entry.integrationKey}:${icon}`;
    return runQueuedNoteToolbarRequest(this.noteToolbarSetupQueue, key, async () => {
      const toolSettings = getObsidianToolsSettingsFromBag(this.settings);
      const cli = new ObsidianCliTransport(toolSettings, {
        processRunner: this.processRunner,
        vaultPath: getVaultPath(this.app),
      });
      return setupNoteToolbar({
        adapter: this.app.vault.adapter,
        apiVersion,
        cliAvailable: toolSettings.cliEnabled && isOfficialObsidianCliEnabled(),
        commandId: getWorkspaceCommandFullId(this.manifest.id, entry.integrationKey!),
        configDir: this.app.vault.configDir,
        itemStyle: 'icon-only',
        itemIcon: icon,
        itemTooltip: t('settings.noteToolbar.commandTooltip', { name: entry.name }),
        getItemApi: (itemId) => this.getNoteToolbarItemApi(itemId),
        getInstalledPluginVersion: (pluginId) =>
          getInstalledPluginVersion(this.app, pluginId),
        isPluginEnabled: (pluginId) => isPluginEnabled(this.app, pluginId),
        openUri: openExternalUrl,
        runCli: (args) => cli.run({ vaultName: this.app.vault.getName(), args }),
      });
    });
  }

  private getNoteToolbarItemApi(itemId: string) {
    const api = (window as Window & {
      ntb?: { getItem?: (id: string) => NoteToolbarItemApi | undefined };
    }).ntb?.getItem?.(itemId);
    return api ?? null;
  }

  private get sessions(): OpenSessionState[] {
    return this.sessionManager.getAll();
  }

  private set sessions(value: OpenSessionState[]) {
    this.sessionManager.replaceAll(value);
  }

  private sessionContext(): sessionApi.PluginSessionContext {
    return {
      sessionManager: this.sessionManager,
      requireSessionStore: () => this.requireSessionStore(),
      storage: this.storage,
      getSessionList: () => this.getSessionList(),
      getAllViews: () => this.getAllViews(),
      setSessions: (sessions) => {
        this.sessions = sessions;
      },
      getSessions: () => this.sessions,
    };
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
    await this.purgeExpiredDeletedSessionFiles().catch((error: unknown) => {
      logger.warn('Failed to purge expired deleted sessions during startup', error);
    });
    this.registerInterval(window.setInterval(() => {
      void this.purgeExpiredDeletedSessionFiles().catch((error: unknown) => {
        logger.warn('Failed to purge expired deleted sessions', error);
      });
    }, DELETED_SESSION_PURGE_INTERVAL_MS));
  }

  onunload(): void {
    this.isUnloading = true;
    this.chatPerfController.dispose();
    this.workspaceGeneration += 1;
    this.workspaceCommandRegistry.clear();
    const persistence = persistOpenTabStates(this.app);
    const workspace = this.piWorkspace;
    this.piWorkspace = null;
    // Best-effort: drop the live journal binding. Device-local journal/source
    // state remains for deterministic startup reconciliation.
    void import('@pivi/engine-pi/application/session')
      .then(({ bindSessionJournal }) => {
        bindSessionJournal(null);
      })
      .catch(() => undefined);
    if (workspace) {
      void workspace.dispose().catch((error: unknown) => {
        logger.error('Failed to dispose workspace services', error);
      });
    }
    void persistence.catch((error: unknown) => {
      logger.error('Failed to persist open tab states on unload', error);
    });
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
    this.storage = createSharedStorage(this.plugin, this.deviceLocalExternalContexts);
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
        ),
      hideDeletedSessionSummaries: () =>
        sessionApi.hideDeletedSessionSummaries(this.sessionContext()),
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
      getSessions: () => this.sessions,
      setLastKnownTabManagerState: (state) => {
        this.lastKnownTabManagerState = state as AppTabManagerState | null;
      },
      getStorage: () => this.storage,
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

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getEnvironmentVariablesForSettingsScope(this.settings, scope);
  }

  private reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  } {
    return PiSettingsCoordinator.reconcileSettings(this.settings, this.sessions);
  }

  async forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null> {
    return sessionApi.forkSessionAt(this.sessionContext(), openSession, atEntryId);
  }

  async createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState> {
    return sessionApi.createOpenSession(this.sessionContext(), options);
  }

  async openSessionByFile(sessionFile: string): Promise<OpenSessionState> {
    return sessionApi.openSessionByFile(this.sessionContext(), sessionFile);
  }

  async deleteSession(id: string): Promise<void> {
    await this.runDeletedSessionOperation(() => sessionApi.deleteSession(this.sessionContext(), id));
  }

  async deleteSessionFile(sessionFile: string, openSessionId?: string | null): Promise<void> {
    await this.runDeletedSessionOperation(() => sessionApi.deleteSessionFile(
      this.sessionContext(),
      sessionFile,
      openSessionId,
    ));
  }

  async purgeDeletedSessionFiles(): Promise<number> {
    return this.runDeletedSessionOperation(() => (
      sessionApi.purgeDeletedSessionFiles(this.sessionContext())
    ));
  }

  async purgeExpiredDeletedSessionFiles(): Promise<number> {
    return this.runDeletedSessionOperation(() => sessionApi.purgeExpiredDeletedSessionFiles(
      this.sessionContext(),
      this.settings.deletedSessionRetentionDays,
    ));
  }

  async renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void> {
    await sessionApi.renameSession(this.sessionContext(), id, title, titleSource);
  }

  async updateSession(
    id: string,
    updates: Partial<OpenSessionState>,
  ): Promise<void> {
    await sessionApi.updateSession(this.sessionContext(), id, updates);
  }

  async getOpenSessionById(id: string): Promise<OpenSessionState | null> {
    return sessionApi.getOpenSessionById(this.sessionContext(), id);
  }

  async openRecentSessionMessages(
    id: string,
    limit: number,
  ): Promise<SessionMessagePage | null> {
    return sessionApi.openRecentSessionMessages(this.sessionContext(), id, limit);
  }

  async readOlderSessionMessages(
    id: string,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage | null> {
    return sessionApi.readOlderSessionMessages(
      this.sessionContext(),
      id,
      beforeEntryId,
      limit,
    );
  }

  getOpenSessionSync(id: string): OpenSessionState | null {
    return sessionApi.getOpenSessionSync(this.sessionContext(), id);
  }

  findEmptySession(): OpenSessionState | null {
    return sessionApi.findEmptySession(this.sessionContext());
  }

  getSessionList(): SessionSummary[] {
    return sessionApi.getSessionList(this.sessionContext());
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

  async reconcileWorkspaceCommands(): Promise<void> {
    const workspace = await this.ensureWorkspaceServices();
    this.workspaceCommandRegistry.reconcile(
      await workspace.slashCommandCatalog.listWorkspaceEntries(),
    );
  }

  reconcileWorkspaceCommandEntries(entries: readonly SlashCatalogEntry[]): void {
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
      sessionRecovery: this.sessionRecovery,
      refreshPiviManagement: (domain: 'mcp' | 'skills' | 'commands' | 'prompt') =>
        this.refreshPiviManagement(domain),
    };
  }
}

export interface PiviApplicationLifecycle {
  onload(): Promise<void>;
  onunload(): void;
}

export function createPiviApplication(plugin: Plugin): PiviApplicationLifecycle {
  return new PiviApplication(plugin);
}

/* eslint-enable max-lines -- End application composition exemption. */
