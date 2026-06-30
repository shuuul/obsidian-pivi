// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
import { patchRendererFetchForElectron } from './utils/nodeFetch';
patchSetMaxListenersForElectron();
patchRendererFetchForElectron();


import type { Editor, WorkspaceLeaf } from 'obsidian';
import { addIcon, MarkdownView, Notice, Plugin } from 'obsidian';

import { DEFAULT_PIVI_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import { findAllPiviViews, findPiviView } from './app/viewAccess';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/agent/agentEnvironment';
import { AgentServices } from './core/agent/AgentServices';
import { AgentSettingsCoordinator } from './core/agent/AgentSettingsCoordinator';
import { AgentWorkspace } from './core/agent/AgentWorkspace';
import type { AppTabManagerState } from './core/agent/types';
import type { SharedAppStorage } from './core/bootstrap/storage';
import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from './core/types';
import {
  VIEW_TYPE_PIVI,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import { PiviView } from './features/chat/PiviView';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { PiviSettingTab } from './features/settings/PiviSettings';
import { setLocale, t } from './i18n/i18n';
import type { Locale } from './i18n/types';
import {
  isSecretStorageAvailable,
  syncPiProvidersFromKeychain,
} from './pi/auth/ProviderSecretStorage';
import { bootstrapPiAgent } from './pi/bootstrap';
import { PiSessionStore } from './pi/session/PiSessionStore';
import { setSessionStore } from './pi/session/sessionStoreRegistry';
import { getSessionStore } from './pi/session/sessionStoreRegistry';
import { getPiAgentSettings, updatePiAgentSettings } from './pi/settings';
import { ensureDefaultVaultSkills } from './pi/skills/ensureDefaultVaultSkills';
import { warmPiAiModelsCache } from './pi/ui/PiChatUIConfig';
import { buildCursorContext } from './utils/editor';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

export default class PiviPlugin extends Plugin {
  settings!: PiviSettings;
  storage!: SharedAppStorage;
  private sessions: OpenSessionState[] = [];
  private lastKnownTabManagerState: AppTabManagerState | null = null;

  async onload() {
    bootstrapPiAgent();
    await this.loadSettings();
    await AgentWorkspace.initializeAll(this);
    warmPiAiModelsCache();

    addIcon(
      'pivi-p',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <mask id="pivi-p-cutout">
            <rect width="100" height="100" fill="black" />
            <rect x="23" y="14" width="18" height="72" rx="9" fill="white" />
            <g transform="rotate(18 56 35)">
              <ellipse cx="56" cy="35" rx="31" ry="25" fill="white" />
            </g>
            <g transform="rotate(-20 58 36)">
              <ellipse cx="58" cy="36" rx="14" ry="11" fill="black" />
            </g>
          </mask>
        </defs>
        <rect width="100" height="100" fill="#6F6F6F" mask="url(#pivi-p-cutout)" />
      </svg>`
    );

    this.registerView(
      VIEW_TYPE_PIVI,
      (leaf) => new PiviView(leaf, this)
    );

    this.addRibbonIcon('pivi-p', 'Open Pivi', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit',
      editorCallback: async (editor: Editor, ctx) => {
        const view = ctx instanceof MarkdownView
          ? ctx
          : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice('Inline edit unavailable: could not access the active Markdown view.');
          return;
        }

        const selectedText = editor.getSelection();
        const notePath = view.file?.path || 'unknown';

        let editContext: InlineEditContext;
        if (selectedText.trim()) {
          editContext = { mode: 'selection', selectedText };
        } else {
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: 'cursor', cursorContext };
        }

        const modal = new InlineEditModal(
          this.app,
          this,
          editor,
          view,
          editContext,
          notePath,
          () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
        );
        const result = await modal.openAndWait();

        if (result.decision === 'accept' && result.editedText !== undefined) {
          new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
        }
      },
    });

    this.addCommand({
      id: 'add-selection-to-chat-input',
      name: t('chat.inlineContext.addSelectionToChatInput'),
      editorCallback: (editor: Editor, ctx) => {
        const view = ctx instanceof MarkdownView
          ? ctx
          : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() === 'preview') {
          new Notice(t('chat.inlineContext.selectTextFirst'));
          return;
        }

        void this.addEditorSelectionToChatInput(editor, view);
      },
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        if (!editor.somethingSelected()) {
          return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.file?.path !== info.file?.path || view.getMode() === 'preview') {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle(t('chat.inlineContext.addSelectionToChatInput'))
            .setIcon('text-select')
            .onClick(() => {
              void this.addEditorSelectionToChatInput(editor, view);
            });
        });
      }),
    );

    this.addCommand({
      id: 'new-tab',
      name: 'New tab',
      checkCallback: (checking: boolean) => {
        if (!this.canCreateNewTab()) return false;

        if (!checking) {
          void this.openNewTab();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'new-session',
      name: 'New session (in current tab)',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        const activeTab = tabManager.getActiveTab();
        if (!activeTab) return false;

        if (activeTab.state.isStreaming) return false;

        if (!checking) {
          void tabManager.createNewSession();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'close-current-tab',
      name: 'Close current tab',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        if (!checking) {
          const activeTabId = tabManager.getActiveTabId();
          if (activeTabId) {
            void tabManager.closeTab(activeTabId);
          }
        }
        return true;
      },
    });

    this.addSettingTab(new PiviSettingTab(this.app, this));
  }

  onunload(): void {
    void this.persistOpenTabStates();
  }

  private async persistOpenTabStates(): Promise<void> {
    // Ensures state is saved even if Obsidian quits without calling onClose()
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (tabManager) {
        const state = tabManager.getPersistedState();
        await this.persistTabManagerState(state);
      }
    }
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

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private canCreateNewTab(): boolean {
    const hasPiviLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PIVI).length > 0;
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

  private async openNewTab(): Promise<void> {
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

  private async addEditorSelectionToChatInput(editor: Editor, markdownView: MarkdownView): Promise<void> {
    const view = await this.ensureViewOpen();
    const activeTab = view?.getActiveTab();
    const manager = activeTab?.ui.inlineContextManager;
    if (!manager) {
      new Notice(t('chat.inlineContext.noActiveChatInput'));
      return;
    }

    const added = manager.addSelectionFromEditor(editor, markdownView);
    if (added) {
      new Notice(t('chat.inlineContext.selectionAdded'), 2000);
    }
  }

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    const { pivi } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_PIVI_SETTINGS,
      ...pivi,
    };

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost).
    const loadedPermissionMode = (pivi as { permissionMode?: string }).permissionMode;
    if (loadedPermissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();
    await this.migrateProviderSecretsToKeychain();

    const vaultPath = getVaultPath(this.app);
    if (vaultPath) {
      setSessionStore(new PiSessionStore(this.storage.getAdapter(), vaultPath));
    }

    if (vaultPath) {
      const summaries = await getSessionStore().listSessions(vaultPath);
      this.sessions = summaries.map((summary) => ({
        id: summary.sessionId,
        title: summary.title,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
        lastResponseAt: summary.updatedAt,
        sessionId: summary.sessionId,
        sessionFile: summary.sessionFile,
        leafCount: summary.leafCount,
        messages: [],
        titleGenerationStatus: undefined,
      }));
    } else {
      this.sessions = [];
    }
    setLocale(this.settings.locale as Locale);

    const backfilledSessions = this.backfillSessionResponseTimestamps();

    const { changed, invalidatedSessions } = this.reconcileModelWithEnvironment();

    AgentSettingsCoordinator.projectActiveAgentState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants) {
      await this.saveSettings();
    }

    for (const conv of [...backfilledSessions, ...invalidatedSessions]) {
      await this.persistSessionSummary(conv);
    }

    void ensureDefaultVaultSkills(this).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Pivi: default vault skills install failed', message);
    });
  }

  private async persistSessionSummary(openSession: OpenSessionState): Promise<void> {
    if (!openSession.sessionFile) {
      return;
    }
    try {
      const store = getSessionStore();
      const resolvedLeaf = typeof openSession.leafId === 'string' && openSession.leafId.length > 0
        ? openSession.leafId
        : undefined;
      const ref = await store.open(openSession.sessionFile, resolvedLeaf);
      await store.writeSessionMeta(ref, {
        title: openSession.title,
        titleGenerationStatus: openSession.titleGenerationStatus,
        lastResponseAt: openSession.lastResponseAt,
        createdAt: openSession.createdAt,
      });
      openSession.leafId = ref.leafId;
      await store.writeUiContext(ref, {
        currentNote: openSession.currentNote,
        externalContextPaths: openSession.externalContextPaths,
        enabledMcpServers: openSession.enabledMcpServers,
      });
    } catch (error) {
      console.error('Pivi: failed to persist session metadata', error);
    }
  }

  private async migrateProviderSecretsToKeychain(): Promise<void> {
    if (!isSecretStorageAvailable(this.app.secretStorage)) {
      return;
    }

    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const piSettings = getPiAgentSettings(settingsBag);
    const synced = syncPiProvidersFromKeychain(
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
    const updated: OpenSessionState[] = [];
    for (const conv of this.sessions) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;

      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant') {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }

  normalizeModelVariantSettings(): boolean {
    return AgentSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async saveSettings() {
    await this.storage.savePiviSettings(this.settings);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
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
    AgentSettingsCoordinator.handleEnvironmentChange(settingsBag);
    const { changed, invalidatedSessions } = this.reconcileModelWithEnvironment();
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
      const syncTabRuntimeState = (tab: (typeof affectedTabs)[number]): void => {
        if (!tab.service || !tab.serviceInitialized) {
          return;
        }

        const openSession = tab.openSessionId
          ? this.getOpenSessionSync(tab.openSessionId)
          : null;
        const hasOpenSessionContext = (openSession?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasOpenSessionContext
            ? openSession?.externalContextPaths ?? []
            : this.settings.persistentExternalContextPaths ?? []);

        tab.service.syncOpenSessionState(openSession, externalContextPaths);
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
            console.warn('Pivi: tab failed to restart after environment change', error);
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
            console.warn('Pivi: tab failed to refresh after environment change', error);
            failedTabs++;
          }
        }
      }
      if (failedTabs > 0) {
        new Notice(`Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`);
      }
    }

    for (const openView of this.getAllViews()) {
      openView.invalidateSlashCommandCaches();
      openView.refreshModelSelector();
    }

    const noticeText = changed
      ? 'Environment variables applied. Sessions will be rebuilt on next message.'
      : 'Environment variables applied.';
    new Notice(noticeText);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(): string {
    return getRuntimeEnvironmentText(this.settings);
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  private reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  } {
    return AgentSettingsCoordinator.reconcileAgentSettings(
      this.settings,
      this.sessions,
    );
  }

  private environmentChangesAffectRuntime(scopes: EnvironmentScope[]): boolean {
    return scopes.some((scope) => scope === 'shared' || scope === 'pi');
  }

  private generateOpenSessionId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getOpenSessionPreview(conv: OpenSessionState): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'New session';
    }
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  private async loadSdkMessagesForOpenSession(
    openSession: OpenSessionState,
    leafId?: string | null,
  ): Promise<void> {
    await AgentServices
      .getSessionHistoryService()
      .hydrateSessionHistory(openSession, getVaultPath(this.app), leafId);
  }

  async createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState> {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let sessionFile = options?.sessionFile;
    let leafId = options?.leafId ?? null;
    let sessionId = options?.sessionId ?? null;

    if (!sessionFile) {
      const ref = await getSessionStore().create(vaultPath);
      sessionFile = ref.sessionFile;
      leafId = ref.leafId;
      sessionId = ref.sessionId;
      await getSessionStore().writeSessionMeta(ref, {
        title: this.generateDefaultTitle(),
        createdAt: Date.now(),
      });
    }

    const existing = this.sessions.find((c) => c.sessionFile === sessionFile);
    if (existing) {
      return existing;
    }

    const openSession: OpenSessionState = {
      id: sessionId ?? this.generateOpenSessionId(),
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastResponseAt: undefined,
      sessionId,
      sessionFile,
      leafId,
      messages: [],
    };

    this.sessions.unshift(openSession);
    await this.persistSessionSummary(openSession);

    return openSession;
  }

  async openSessionByFile(sessionFile: string, leafId?: string | null): Promise<OpenSessionState> {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let openSession = this.sessions.find((c) => c.sessionFile === sessionFile);
    if (!openSession) {
      const opened = await getSessionStore().open(sessionFile, leafId ?? undefined);
      openSession = await this.createOpenSession({
        sessionFile: opened.sessionFile,
        sessionId: opened.sessionId,
        leafId: opened.leafId,
      });
    }

    await this.loadSdkMessagesForOpenSession(openSession, leafId);
    return openSession;
  }

  async switchSession(id: string, leafId?: string | null): Promise<OpenSessionState | null> {
    const openSession = this.sessions.find(c => c.id === id);
    if (!openSession) return null;

    await this.loadSdkMessagesForOpenSession(openSession, leafId);

    return openSession;
  }

  async deleteSession(id: string): Promise<void> {
    const index = this.sessions.findIndex(c => c.id === id);
    if (index === -1) return;

    const openSession = this.sessions[index];
    this.sessions.splice(index, 1);

    await AgentServices
      .getSessionHistoryService()
      .deleteSessionFile(openSession, getVaultPath(this.app));

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.openSessionId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.openSessionController?.createNew({ force: true });
        }
      }
    }
  }

  async renameSession(id: string, title: string): Promise<void> {
    const openSession = this.sessions.find(c => c.id === id);
    if (!openSession) return;

    openSession.title = title.trim() || this.generateDefaultTitle();
    openSession.updatedAt = Date.now();

    await this.persistSessionSummary(openSession);
  }

  async updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void> {
    const openSession = this.sessions.find(c => c.id === id);
    if (!openSession) return;

    Object.assign(openSession, updates, { updatedAt: Date.now() });

    await this.persistSessionSummary(openSession);

    // Clear image data from memory after save (data is persisted in JSONL).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    if (!AgentServices.getSessionHistoryService().isPendingForkSession(openSession)) {
      for (const msg of openSession.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  async getOpenSessionById(id: string, leafId?: string | null): Promise<OpenSessionState | null> {
    const openSession = this.sessions.find(c => c.id === id) || null;

    if (openSession) {
      await this.loadSdkMessagesForOpenSession(openSession, leafId);
    }

    return openSession;
  }

  getOpenSessionSync(id: string): OpenSessionState | null {
    return this.sessions.find(c => c.id === id) || null;
  }

  findEmptySession(): OpenSessionState | null {
    return this.sessions.find(c => c.messages.length === 0) || null;
  }

  getSessionList(): SessionSummary[] {
    return this.sessions.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getOpenSessionPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
      sessionFile: c.sessionFile,
      leafId: c.leafId,
      leafCount: c.leafCount,
    }));
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

  findSessionAcrossViews(openSessionId: string): { view: PiviView; tabId: string } | null {
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

}
