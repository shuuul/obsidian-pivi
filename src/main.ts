// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from "@pivi/obsidian-host/electronCompat";
import { patchRendererFetchForElectron } from "@pivi/obsidian-host/nodeFetch";
patchSetMaxListenersForElectron();
patchRendererFetchForElectron();

import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { ObsidianCliTransport } from "@pivi/obsidian-host/cli/obsidianCliTransport";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import { obsidianHttpClient } from "@pivi/obsidian-host/obsidianHttpClient";
import { openExternalUrl } from "@pivi/obsidian-host/openExternalUrl";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import { warmPiAiModelsCache } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from "@pivi/pivi-agent-core/foundation";
import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import {
  type ChatViewPlacement,
  type EnvironmentScope,
  getObsidianToolsSettingsFromBag,
} from "@pivi/pivi-agent-core/foundation/settings";
import type { LeafSummary, SessionStore } from "@pivi/pivi-agent-core/session";
import { OpenSessionManager } from "@pivi/pivi-agent-core/session/openSessionManager";
import type { Editor, MarkdownView, WorkspaceLeaf } from "obsidian";
import { apiVersion, Notice, Plugin } from "obsidian";

import {
  ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID,
  registerPiviCommands,
} from "@/app/commandRegistration";
import type { PiviChatView, PiviPluginHost, PiviPluginWorkspace } from "@/app/hostContracts";
import { getVaultPath } from "@/app/hostPlatform";
import {
  type NoteToolbarItemStyle,
  type NoteToolbarSetupResult,
  setupNoteToolbarIntegration as setupNoteToolbar,
} from "@/app/noteToolbarIntegration";
import { initializePiviPlugin, persistOpenTabStates } from "@/app/pluginLifecycle";
import * as sessionApi from "@/app/pluginSessionApi";
import { loadPluginSettings } from "@/app/pluginSettingsLoad";
import {
  createPluginServiceGraph,
  createSessionStore,
  createSharedStorage,
} from "@/app/serviceGraph";
import {
  applyEnvironmentVariablesBatch as applyEnvironmentVariablesBatchForPlugin,
  getActiveEnvironmentVariables as getActiveEnvironmentVariablesFromSettings,
  getEnvironmentVariablesForScope as getEnvironmentVariablesForSettingsScope,
} from "@/app/settings/environmentVariables";
import { registerPiviSettings } from "@/app/settingsRegistration";
import { findAllPiviViews, findPiviView } from "@/app/viewAccess";
import { registerPiviViews } from "@/app/viewRegistration";
import { createPiUiFacades } from "@/app/workspace/piUiFacades";
import type { PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices";
import { t } from "@/i18n";
import { revealWorkspaceLeaf } from "@/ui/shared/utils/obsidianCompat";

const STYLE_SETTINGS_PLUGIN_ID = "obsidian-style-settings";
const STYLE_SETTINGS_MARKETPLACE_URI =
  `obsidian://show-plugin?id=${STYLE_SETTINGS_PLUGIN_ID}`;

type SettingsNavigator = {
  pluginTabs?: Array<{ id?: string }>;
  openTabById?: (id: string) => unknown;
};

type NoteToolbarSetup = {
  itemStyle: NoteToolbarItemStyle;
  promise: Promise<NoteToolbarSetupResult>;
};

/**
 * Thin Obsidian Plugin composition root. Product lifecycle, sessions, and
 * settings load live under src/app/; this class wires host methods and DI.
 */
export default class PiviPlugin extends Plugin implements PiviPluginHost {
  settings!: PiviSettings;
  readonly httpClient = obsidianHttpClient;
  readonly processRunner = systemProcessRunner;
  storage!: SharedAppStorage;
  private readonly sessionManager = new OpenSessionManager({
    getVaultPath: () => getVaultPath(this.app),
    getStore: () => this.requireSessionStore(),
  });
  private sessionStore: SessionStore | null = null;
  private piWorkspace: PiWorkspaceServices | null = null;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private noteToolbarSetup: NoteToolbarSetup | null = null;
  private readonly uiFacades = createPiUiFacades((providerId) => {
    const credential = this.piWorkspace?.credentialStore?.readSync(providerId);
    if (!credential || credential.type !== "api_key" || !("key" in credential)) {
      return undefined;
    }
    return typeof credential.key === "string" ? credential.key : undefined;
  });

  getVaultPath(): string | null {
    return getVaultPath(this.app);
  }

  notify(message: string | DocumentFragment, timeout?: number): Notice {
    return new Notice(message, timeout);
  }

  async openStyleSettings(): Promise<boolean> {
    const navigator = (this.app as typeof this.app & {
      setting?: SettingsNavigator;
    }).setting;
    if (
      navigator?.openTabById &&
      navigator.pluginTabs?.some((tab) => tab.id === STYLE_SETTINGS_PLUGIN_ID)
    ) {
      navigator.openTabById(STYLE_SETTINGS_PLUGIN_ID);
      return true;
    }

    await openExternalUrl(STYLE_SETTINGS_MARKETPLACE_URI);
    return false;
  }

  async setupNoteToolbarIntegration(
    itemStyle: NoteToolbarItemStyle,
  ): Promise<NoteToolbarSetupResult> {
    const activeSetup = this.noteToolbarSetup;
    if (activeSetup?.itemStyle === itemStyle) {
      return await activeSetup.promise;
    }
    if (activeSetup) {
      await activeSetup.promise;
      return await this.setupNoteToolbarIntegration(itemStyle);
    }

    const toolSettings = getObsidianToolsSettingsFromBag(this.settings);
    const cli = new ObsidianCliTransport(toolSettings);
    const setup: NoteToolbarSetup = {
      itemStyle,
      promise: setupNoteToolbar({
        adapter: this.app.vault.adapter,
        apiVersion,
        cliAvailable:
          toolSettings.cliEnabled && isOfficialObsidianCliEnabled(),
        commandId: `${this.manifest.id}:${ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID}`,
        configDir: this.app.vault.configDir,
        itemStyle,
        itemTooltip: t("settings.noteToolbar.itemTooltip"),
        openUri: openExternalUrl,
        runCli: (args) =>
          cli.run({ vaultName: this.app.vault.getName(), args }),
      }),
    };
    this.noteToolbarSetup = setup;

    try {
      return await setup.promise;
    } finally {
      if (this.noteToolbarSetup === setup) {
        this.noteToolbarSetup = null;
      }
    }
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
    await initializePiviPlugin(this);
  }

  onunload(): void {
    void persistOpenTabStates(this);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PIVI)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_PIVI,
          active: true,
        });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  private getLeafForPlacement(
    placement: ChatViewPlacement,
  ): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case "main-tab":
        return workspace.getLeaf("tab");
      case "left-sidebar":
        return workspace.getLeftLeaf(false);
      case "right-sidebar":
        return workspace.getRightLeaf(false);
    }
  }

  canCreateNewTab(): boolean {
    const hasPiviLeaf =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PIVI).length > 0;
    const view = findPiviView(this.app);
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasPiviLeaf) {
      return false;
    }

    return true;
  }

  private async ensureViewOpen(): Promise<PiviChatView | null> {
    const existingView = findPiviView(this.app);
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return findPiviView(this.app);
  }

  async openNewTab(): Promise<void> {
    const existingView = findPiviView(this.app);
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  async addEditorSelectionToChatInput(
    editor: Editor,
    markdownView: MarkdownView,
  ): Promise<void> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const manager = activeTab?.ui.inlineContextManager;
    if (!manager) {
      new Notice(t("chat.inlineContext.noActiveChatInput"));
      return;
    }

    const added = manager.addSelectionFromEditor(editor, markdownView);
    if (added) {
      new Notice(t("chat.inlineContext.selectionAdded"), 2000);
    }
  }

  getAgentHostContext(): AgentHostContext {
    return {
      settings: this.settings,
      storage: this.storage,
      vaultPath: getVaultPath(this.app),
      sessionStore: this.sessionStore,
      rawHost: this,
    };
  }

  private requireSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error("Session store is not initialized");
    }
    return this.sessionStore;
  }

  getPiWorkspace(): PiviPluginWorkspace | null {
    return this.piWorkspace;
  }

  getUiFacades() {
    return this.uiFacades;
  }

  createChatService() {
    const workspace = this.piWorkspace;
    if (!workspace) {
      throw new Error("Pi workspace is not initialized");
    }
    return workspace.createChatService(this, this.httpClient);
  }

  createAuxQueryRunner() {
    const workspace = this.piWorkspace;
    if (!workspace) {
      throw new Error("Pi workspace is not initialized");
    }
    return workspace.createAuxQueryRunner(this);
  }

  async loadSettings() {
    this.storage = createSharedStorage(this);
    await loadPluginSettings({
      app: this.app,
      storage: this.storage,
      sessionManager: this.sessionManager,
      createSessionStore: (vaultAdapter, vaultPath) =>
        createSessionStore(vaultAdapter, vaultPath),
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
  }

  async saveSettings() {
    await this.storage.savePiviSettings(this.settings);
  }

  async applyEnvironmentVariables(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
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

  async listSessionLeaves(sessionFile: string): Promise<LeafSummary[]> {
    return sessionApi.listSessionLeaves(this.sessionContext(), sessionFile);
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
    leafId?: string | null;
  }): Promise<OpenSessionState> {
    return sessionApi.createOpenSession(this.sessionContext(), options);
  }

  async openSessionByFile(
    sessionFile: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState> {
    return sessionApi.openSessionByFile(this.sessionContext(), sessionFile);
  }

  async switchSession(
    id: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return sessionApi.switchSession(this.sessionContext(), id);
  }

  async deleteSession(id: string): Promise<void> {
    await sessionApi.deleteSession(this.sessionContext(), id);
  }

  async purgeDeletedSessionFiles(): Promise<number> {
    return sessionApi.purgeDeletedSessionFiles(this.sessionContext());
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

  async getOpenSessionById(
    id: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return sessionApi.getOpenSessionById(this.sessionContext(), id);
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

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): PiviChatView | null {
    return findPiviView(this.app);
  }

  getAllViews(): PiviChatView[] {
    return findAllPiviViews(this.app);
  }

  findSessionAcrossViews(
    openSessionId: string,
  ): { view: PiviChatView; tabId: string } | null {
    return sessionApi.findSessionAcrossViews(this.getAllViews(), openSessionId);
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  async initializeWorkspaceServices(): Promise<void> {
    const graph = await createPluginServiceGraph(this);
    this.piWorkspace = graph.piWorkspace;
    warmPiAiModelsCache();
    registerPiviViews(this);
    registerPiviCommands(this);
    registerPiviSettings(this);
  }
}
