// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from "@pivi/obsidian-host/electronCompat";
import { patchRendererFetchForElectron } from "@pivi/obsidian-host/nodeFetch";
patchSetMaxListenersForElectron();
patchRendererFetchForElectron();

import { getVaultPath } from "@pivi/obsidian-host";
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { obsidianHttpClient } from "@pivi/obsidian-host/obsidianHttpClient";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import { warmPiAiModelsCache } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import { migratePiProviderCredentialsToKeychain } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from "@pivi/pivi-agent-core/foundation";
import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/pivi-agent-core/foundation/agentSettings";
import type {
  ChatViewPlacement,
  EnvironmentScope,
} from "@pivi/pivi-agent-core/foundation/settings";
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from "@pivi/pivi-agent-core/foundation/settingsAgentEnvironment";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";
import type { LeafSummary, SessionStore } from "@pivi/pivi-agent-core/session";
import { OpenSessionManager } from "@pivi/pivi-agent-core/session/openSessionManager";
import { ensureDefaultVaultSkills } from "@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills";
import type { Editor, MarkdownView,WorkspaceLeaf } from "obsidian";
import { Notice, Plugin } from "obsidian";

import { registerPiviCommands } from "@/app/commandRegistration";
import { initializePiviPlugin, persistOpenTabStates } from "@/app/pluginLifecycle";
import {
  createPluginServiceGraph,
  createSessionStore,
  createSharedStorage,
} from "@/app/serviceGraph";
import { registerPiviSettings } from "@/app/settingsRegistration";
import { findAllPiviViews, findPiviView } from "@/app/viewAccess";
import { registerPiviViews } from "@/app/viewRegistration";
import type { PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices";
import type { Locale } from "@/i18n";
import { setLocale, t } from "@/i18n";
import type { PiviView } from "@/ui/chat/view/PiviView";
import { revealWorkspaceLeaf } from "@/ui/shared/utils/obsidianCompat";

// TODO(plugin-shell): keep shrinking this Obsidian entry by moving remaining
// command/view glue into focused modules; service construction is already split
// into serviceGraph.ts.
export default class PiviPlugin extends Plugin {
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
  getVaultPath(): string | null {
    return getVaultPath(this.app);
  }

  notify(message: string | DocumentFragment, timeout?: number): Notice {
    return new Notice(message, timeout);
  }


  private get sessions(): OpenSessionState[] {
    return this.sessionManager.getAll();
  }

  private set sessions(value: OpenSessionState[]) {
    this.sessionManager.replaceAll(value);
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
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasPiviLeaf) {
      return false;
    }

    return true;
  }

  private async ensureViewOpen(): Promise<PiviView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  async openNewTab(): Promise<void> {
    const existingView = this.getView();
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

  getPiWorkspace(): PiWorkspaceServices | null {
    return this.piWorkspace;
  }

  async loadSettings() {
    this.storage = createSharedStorage(this);
    const { pivi } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_PIVI_SETTINGS,
      ...pivi,
    };

    const didReconcileModelSelections =
      PiSettingsCoordinator.reconcileTitleGenerationModelSelection(this.settings);
    await this.migrateProviderSecretsToKeychain();

    const vaultPath = getVaultPath(this.app);
    if (vaultPath) {
      this.sessionStore = createSessionStore(this.storage.getAdapter(), vaultPath);
    } else {
      this.sessionStore = null;
    }

    await this.sessionManager.loadSummaries();
    await this.hideDeletedSessionSummaries();
    setLocale(this.settings.locale as Locale);

    const backfilledSessions = this.backfillSessionResponseTimestamps();

    const { changed, invalidatedSessions } =
      this.reconcileModelWithEnvironment();

    PiSettingsCoordinator.projectActivePiState(this.settings);

    if (changed || didReconcileModelSelections) {
      await this.saveSettings();
    }

    for (const conv of [...backfilledSessions, ...invalidatedSessions]) {
      await this.persistSessionSummary(conv);
    }

    void ensureDefaultVaultSkills(this).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Pivi: default vault skills install failed", message);
    });
  }

  private async persistSessionSummary(
    openSession: OpenSessionState,
  ): Promise<void> {
    await this.sessionManager.persistSessionSummary(openSession);
  }

  private async migrateProviderSecretsToKeychain(): Promise<void> {
    if (!isSecretStorageAvailable(this.app.secretStorage)) {
      return;
    }

    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const piSettings = getPiAgentSettings(settingsBag);
    const synced = migratePiProviderCredentialsToKeychain(
      this.app.secretStorage,
      piSettings.addedProviders,
      piSettings.environmentVariables,
    );
    if (!synced.changed) {
      return;
    }

    updatePiAgentSettings(settingsBag, {
      addedProviders: synced.addedProviders,
      environmentVariables: synced.environmentVariables,
    });
    await this.saveSettings();
  }

  private backfillSessionResponseTimestamps(): OpenSessionState[] {
    return this.sessionManager.backfillSessionResponseTimestamps();
  }

  async saveSettings() {
    await this.storage.savePiviSettings(this.settings);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(
    scope: EnvironmentScope,
    envText: string,
  ): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    const changedScopes: EnvironmentScope[] = [];
    for (const [scope, envText] of nextEnvironmentByScope) {
      const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
      if (currentValue !== envText) {
        changedScopes.push(scope);
      }
      setEnvironmentVariablesForScope(settingsBag, scope, envText);
    }

    if (changedScopes.length === 0) {
      await this.saveSettings();
      return;
    }

    const affectsRuntime = this.environmentChangesAffectRuntime(changedScopes);
    const { changed, invalidatedSessions } =
      this.reconcileModelWithEnvironment();
    await this.saveSettings();

    if (invalidatedSessions.length > 0) {
      for (const conv of invalidatedSessions) {
        await this.persistSessionSummary(conv);
      }
    }

    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      const affectedTabs = affectsRuntime ? tabManager.getAllTabs() : [];
      const syncTabRuntimeState = (
        tab: (typeof affectedTabs)[number],
      ): void => {
        if (!tab.service || !tab.serviceInitialized) {
          return;
        }

        const openSession = tab.openSessionId
          ? this.getOpenSessionSync(tab.openSessionId)
          : null;
        const hasOpenSessionContext = (openSession?.messages.length ?? 0) > 0;
        const externalContextPaths =
          tab.ui.externalContextSelector?.getExternalContexts() ??
          (hasOpenSessionContext
            ? (openSession?.externalContextPaths ?? [])
            : (this.settings.persistentExternalContextPaths ?? []));

        tab.service.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
      };

      for (const tab of affectedTabs) {
        if (tab.state.isStreaming) {
          tab.controllers.inputController?.cancelStreaming();
        }
      }

      let failedTabs = 0;
      if (changed) {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            tab.service.resetSession();
            await tab.service.ensureReady();
          } catch (error) {
            console.warn(
              "Pivi: tab failed to restart after environment change",
              error,
            );
            failedTabs++;
          }
        }
      } else {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            await tab.service.ensureReady({ force: true });
          } catch (error) {
            console.warn(
              "Pivi: tab failed to refresh after environment change",
              error,
            );
            failedTabs++;
          }
        }
      }
      if (failedTabs > 0) {
        new Notice(
          `Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`,
        );
      }
    }

    for (const openView of this.getAllViews()) {
      openView.invalidateSlashCommandCaches();
      openView.refreshModelSelector();
    }

    const noticeText = changed
      ? "Environment variables applied. Sessions will be rebuilt on next message."
      : "Environment variables applied.";
    new Notice(noticeText);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(): string {
    return getRuntimeEnvironmentText(this.settings);
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(this.settings, scope);
  }

  private reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  } {
    return PiSettingsCoordinator.reconcileSettings(this.settings, this.sessions);
  }

  async listSessionLeaves(sessionFile: string): Promise<LeafSummary[]> {
    return this.requireSessionStore().listLeaves(sessionFile);
  }

  async forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null> {
    const store = this.requireSessionStore();
    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return null;
    }

    const forked = await store.fork(ref, atEntryId);
    return {
      sessionFile: forked.sessionFile,
      sessionId: forked.sessionId,
    };
  }

  private environmentChangesAffectRuntime(scopes: EnvironmentScope[]): boolean {
    return scopes.some((scope) => scope === "shared" || scope === "agent");
  }

  async createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState> {
    return this.sessionManager.create(options);
  }

  async openSessionByFile(
    sessionFile: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState> {
    return this.sessionManager.openByFile(sessionFile);
  }

  async switchSession(
    id: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return this.sessionManager.switch(id);
  }

  async deleteSession(id: string): Promise<void> {
    const deleted = await this.sessionManager.delete(id);
    if (!deleted) return;

    if (deleted.sessionFile) {
      await this.markSessionFileDeleted(deleted.sessionFile);
    }

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.openSessionId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.openSessionController?.createNew({
            force: true,
          });
        }
      }
    }
  }

  async purgeDeletedSessionFiles(): Promise<number> {
    const deletedSessionFiles = await this.storage.getDeletedSessionFiles();
    if (deletedSessionFiles.length === 0) {
      return 0;
    }

    const protectedSessionFiles = await this.getProtectedSessionFiles();
    const remainingDeletedSessionFiles: string[] = [];
    let deletedCount = 0;

    for (const sessionFile of deletedSessionFiles) {
      if (protectedSessionFiles.has(sessionFile)) {
        remainingDeletedSessionFiles.push(sessionFile);
        continue;
      }

      try {
        await this.requireSessionStore().deleteSession(sessionFile);
        deletedCount++;
      } catch {
        remainingDeletedSessionFiles.push(sessionFile);
      }
    }

    await this.storage.setDeletedSessionFiles(remainingDeletedSessionFiles);
    return deletedCount;
  }

  private async hideDeletedSessionSummaries(): Promise<void> {
    const deletedSessionFiles = new Set(await this.storage.getDeletedSessionFiles());
    if (deletedSessionFiles.size === 0) {
      return;
    }

    this.sessions = this.sessions.filter((session) => !session.sessionFile || !deletedSessionFiles.has(session.sessionFile));
  }

  private async markSessionFileDeleted(sessionFile: string): Promise<void> {
    const deletedSessionFiles = await this.storage.getDeletedSessionFiles();
    if (deletedSessionFiles.includes(sessionFile)) {
      return;
    }
    await this.storage.setDeletedSessionFiles([...deletedSessionFiles, sessionFile]);
  }

  private async getProtectedSessionFiles(): Promise<Set<string>> {
    const protectedSessionFiles = new Set<string>();

    for (const session of this.getSessionList()) {
      if (session.sessionFile) {
        protectedSessionFiles.add(session.sessionFile);
      }
    }

    const persistedState = await this.storage.getTabManagerState();
    for (const tab of persistedState?.openTabs ?? []) {
      if (tab.sessionFile) {
        protectedSessionFiles.add(tab.sessionFile);
      }
    }

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;
      for (const tab of tabManager.getAllTabs()) {
        if (tab.sessionFile) {
          protectedSessionFiles.add(tab.sessionFile);
        }
      }
    }

    return protectedSessionFiles;
  }

  async renameSession(id: string, title: string): Promise<void> {
    await this.sessionManager.rename(id, title);
  }

  async updateSession(
    id: string,
    updates: Partial<OpenSessionState>,
  ): Promise<void> {
    await this.sessionManager.update(id, updates);
  }

  async getOpenSessionById(
    id: string,
    _leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return this.sessionManager.getById(id);
  }

  getOpenSessionSync(id: string): OpenSessionState | null {
    return this.sessionManager.getSync(id);
  }

  findEmptySession(): OpenSessionState | null {
    return this.sessionManager.findEmpty();
  }

  getSessionList(): SessionSummary[] {
    return this.sessionManager.list();
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  /** @deprecated Prefer `findPiviView(app)` from `app/viewAccess` (no view field on Plugin). */
  getView(): PiviView | null {
    return findPiviView(this.app);
  }

  /** @deprecated Prefer `findAllPiviViews(app)` from `app/viewAccess`. */
  getAllViews(): PiviView[] {
    return findAllPiviViews(this.app);
  }

  findSessionAcrossViews(
    openSessionId: string,
  ): { view: PiviView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.openSessionId === openSessionId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
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
