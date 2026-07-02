// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from "@pivi/obsidian-host/electronCompat";
import { patchRendererFetchForElectron } from "@pivi/obsidian-host/nodeFetch";
patchSetMaxListenersForElectron();
patchRendererFetchForElectron();

import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from "@pivi/core";
import { VIEW_TYPE_PIVI } from "@pivi/core";
import type {
  ChatViewPlacement,
  EnvironmentScope,
} from "@pivi/core/settings";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/core/settingsDefaults";
import { getVaultPath } from "@pivi/obsidian-host";
import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { migratePiProviderCredentialsToKeychain } from "@pivi/pi-runtime/auth/ObsidianCredentialStore";
import { isSecretStorageAvailable } from "@pivi/pi-runtime/auth/ProviderSecretStorage";
import { warmPiAiModelsCache } from "@pivi/pi-runtime/PiChatUIConfig";
import { PiSettingsCoordinator } from "@pivi/pi-runtime/PiSettingsCoordinator";
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from "@pivi/pi-runtime/settings/agentEnvironment";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/pi-runtime/settings/agentSettings";
import type { LeafSummary, SessionStore } from "@pivi/session";
import { OpenSessionManager } from "@pivi/session/OpenSessionManager";
import { ensureDefaultVaultSkills } from "@pivi/skills/vault/ensureDefaultVaultSkills";
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
  storage!: SharedAppStorage;
  private readonly sessionManager = new OpenSessionManager({
    getVaultPath: () => getVaultPath(this.app),
    getStore: () => this.requireSessionStore(),
  });
  private sessionStore: SessionStore | null = null;
  private piWorkspace: PiWorkspaceServices | null = null;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
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

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
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

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost).
    const loadedPermissionMode = (pivi as { permissionMode?: string })
      .permissionMode;
    if (loadedPermissionMode === "plan") {
      this.settings.permissionMode = "normal";
    }
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

        tab.service.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null, leafId: openSession.leafId } : null, externalContextPaths);
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
  ): Promise<{ sessionFile: string; leafId?: string | null; sessionId: string } | null> {
    const store = this.requireSessionStore();
    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return null;
    }

    const forked = await store.fork(ref, atEntryId);
    return {
      sessionFile: forked.sessionFile,
      leafId: forked.leafId,
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
    leafId?: string | null,
  ): Promise<OpenSessionState> {
    return this.sessionManager.openByFile(sessionFile, leafId);
  }

  async switchSession(
    id: string,
    leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return this.sessionManager.switch(id, leafId);
  }

  async deleteSession(id: string): Promise<void> {
    const deleted = await this.sessionManager.delete(id);
    if (!deleted) return;

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
    leafId?: string | null,
  ): Promise<OpenSessionState | null> {
    return this.sessionManager.getById(id, leafId);
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

  private getMaxTabsLimit(): number {
    const maxTabs = this.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
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
