// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
import { patchRendererFetchForElectron } from './utils/nodeFetch';
patchSetMaxListenersForElectron();
patchRendererFetchForElectron();


import type { Editor, WorkspaceLeaf } from 'obsidian';
import { addIcon, MarkdownView, Notice, Plugin } from 'obsidian';

import { DEFAULT_OBSIUS_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/agent/agentEnvironment';
import { PiAgentServices } from './core/agent/PiAgentServices';
import { AgentSettingsCoordinator } from './core/agent/AgentSettingsCoordinator';
import { AgentWorkspace } from './core/agent/AgentWorkspace';
import type { AppTabManagerState } from './core/agent/types';
import type { SharedAppStorage } from './core/bootstrap/storage';
import type {
  Conversation,
  ConversationMeta,
  ObsiusSettings,
} from './core/types';
import {
  VIEW_TYPE_OBSIUS,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import { ObsiusView } from './features/chat/ObsiusView';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { ObsiusSettingTab } from './features/settings/ObsiusSettings';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import {
  isSecretStorageAvailable,
  syncPiProvidersFromKeychain,
} from './pi/auth/ProviderSecretStorage';
import { bootstrapPiAgent } from './pi/bootstrap';
import { getPiAgentSettings, updatePiAgentSettings } from './pi/settings';
import { warmPiAiModelsCache } from './pi/ui/PiChatUIConfig';
import { buildCursorContext } from './utils/editor';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { setSessionStore } from './pi/session/sessionStoreRegistry';
import { PiSessionStore } from './pi/session/PiSessionStore';
import {
  OBSIUS_STORAGE_MIGRATION_KEY,
  runObsiusStorageMigration,
} from './pi/session/obsiusStorageMigration';
import { getSessionStore } from './pi/session/sessionStoreRegistry';
import { getVaultPath } from './utils/path';

function isObsiusView(value: unknown): value is ObsiusView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

export default class ObsiusPlugin extends Plugin {
  settings!: ObsiusSettings;
  storage!: SharedAppStorage;
  private conversations: Conversation[] = [];
  private lastKnownTabManagerState: AppTabManagerState | null = null;

  async onload() {
    bootstrapPiAgent();
    await warmPiAiModelsCache();
    await this.loadSettings();
    await AgentWorkspace.initializeAll(this);

    addIcon(
      'obsius-o',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <mask id="obsius-o-cutout">
            <rect width="100" height="100" fill="black" />
            <g transform="rotate(18 50 50)">
              <ellipse cx="50" cy="50" rx="41" ry="34" fill="white" />
            </g>
            <g transform="rotate(-23 47 54)">
              <ellipse cx="47" cy="54" rx="18" ry="13" fill="black" />
            </g>
          </mask>
        </defs>
        <rect width="100" height="100" fill="#6F6F6F" mask="url(#obsius-o-cutout)" />
      </svg>`
    );

    this.registerView(
      VIEW_TYPE_OBSIUS,
      (leaf) => new ObsiusView(leaf, this)
    );

    this.addRibbonIcon('obsius-o', 'Open Obsius', () => {
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
          void tabManager.createNewConversation();
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

    this.addSettingTab(new ObsiusSettingTab(this.app, this));
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
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_OBSIUS)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_OBSIUS,
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
    const hasObsiusLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_OBSIUS).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasObsiusLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<ObsiusView | null> {
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

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    const { obsius2 } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_OBSIUS_SETTINGS,
      ...obsius2,
    };

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost).
    // Legacy installs may still have removed modes (e.g. yolo) in persisted JSON.
    const loadedPermissionMode = (obsius2 as { permissionMode?: string }).permissionMode;
    if (loadedPermissionMode === 'plan' || loadedPermissionMode === 'yolo') {
      this.settings.permissionMode = 'normal';
    }
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();
    await this.migrateProviderSecretsToKeychain();

    const vaultPath = getVaultPath(this.app);
    if (vaultPath) {
      setSessionStore(new PiSessionStore(this.storage.getAdapter(), vaultPath));
    }

    const pluginDataRaw: unknown = await this.loadData();
    const pluginData = pluginDataRaw && typeof pluginDataRaw === 'object' && !Array.isArray(pluginDataRaw)
      ? pluginDataRaw as Record<string, unknown>
      : null;
    const migrationBag = pluginData?.migration && typeof pluginData.migration === 'object'
      ? pluginData.migration as Record<string, unknown>
      : {};
    const tabState = this.lastKnownTabManagerState;
    if (
      vaultPath
      && pluginData
      && !migrationBag[OBSIUS_STORAGE_MIGRATION_KEY]
      && tabState
    ) {
      const migration = await runObsiusStorageMigration(
        this.storage.getAdapter(),
        vaultPath,
        tabState.openTabs.map((t) => ({
          tabId: t.tabId,
          conversationId: t.conversationId ?? null,
          draftModel: t.draftModel,
        })),
      );
      this.lastKnownTabManagerState = {
        activeTabId: tabState.activeTabId,
        openTabs: migration.tabs.map((t) => ({
          tabId: t.tabId,
          sessionFile: t.sessionFile,
          leafId: t.leafId,
          draftModel: t.draftModel,
        })),
      };
      await this.saveData({
        ...pluginData,
        migration: {
          ...(pluginData.migration as Record<string, unknown> | undefined),
          [OBSIUS_STORAGE_MIGRATION_KEY]: true,
        },
      });
    }

    if (vaultPath) {
      const summaries = await getSessionStore().listSessions(vaultPath);
      this.conversations = summaries.map((summary) => ({
        id: summary.sessionId,
        title: summary.title,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
        lastResponseAt: summary.updatedAt,
        sessionId: summary.sessionId,
        sessionFile: summary.sessionFile,
        messages: [],
        titleGenerationStatus: undefined,
      }));
    } else {
      this.conversations = [];
    }
    setLocale(this.settings.locale as Locale);

    const backfilledConversations = this.backfillConversationResponseTimestamps();

    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();

    AgentSettingsCoordinator.projectActiveAgentState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants) {
      await this.saveSettings();
    }

    for (const conv of [...backfilledConversations, ...invalidatedConversations]) {
      await this.persistConversationMeta(conv);
    }
  }

  private async persistConversationMeta(conversation: Conversation): Promise<void> {
    if (!conversation.sessionFile) {
      return;
    }
    try {
      const store = getSessionStore();
      const resolvedLeaf = typeof conversation.leafId === 'string' && conversation.leafId.length > 0
        ? conversation.leafId
        : undefined;
      const ref = await store.open(conversation.sessionFile, resolvedLeaf);
      await store.writeSessionMeta(ref, {
        title: conversation.title,
        titleGenerationStatus: conversation.titleGenerationStatus,
        lastResponseAt: conversation.lastResponseAt,
        createdAt: conversation.createdAt,
      });
      conversation.leafId = ref.leafId;
      await store.writeUiContext(ref, {
        currentNote: conversation.currentNote,
        externalContextPaths: conversation.externalContextPaths,
        enabledMcpServers: conversation.enabledMcpServers,
      });
    } catch (error) {
      console.error('Obsius: failed to persist session metadata', error);
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

  private backfillConversationResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conv of this.conversations) {
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
    await this.storage.saveObsiusSettings(this.settings);
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
    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();
    await this.saveSettings();

    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.persistConversationMeta(conv);
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

        const conversation = tab.conversationId
          ? this.getConversationSync(tab.conversationId)
          : null;
        const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasConversationContext
            ? conversation?.externalContextPaths ?? []
            : this.settings.persistentExternalContextPaths ?? []);

        tab.service.syncConversationState(conversation, externalContextPaths);
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
          } catch {
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
          } catch {
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
    invalidatedConversations: Conversation[];
  } {
    return AgentSettingsCoordinator.reconcileAgentSettings(
      this.settings,
      this.conversations,
    );
  }

  private environmentChangesAffectRuntime(scopes: EnvironmentScope[]): boolean {
    return scopes.some((scope) => scope === 'shared' || scope === 'pi');
  }

  private generateConversationId(): string {
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

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'New conversation';
    }
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  private async loadSdkMessagesForConversation(
    conversation: Conversation,
    leafId?: string | null,
  ): Promise<void> {
    await PiAgentServices
      .getConversationHistoryService()
      .hydrateConversationHistory(conversation, getVaultPath(this.app), leafId);
  }

  async createConversation(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<Conversation> {
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

    const existing = this.conversations.find((c) => c.sessionFile === sessionFile);
    if (existing) {
      return existing;
    }

    const conversation: Conversation = {
      id: sessionId ?? this.generateConversationId(),
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastResponseAt: undefined,
      sessionId,
      sessionFile,
      leafId,
      messages: [],
    };

    this.conversations.unshift(conversation);
    await this.persistConversationMeta(conversation);

    return conversation;
  }

  async openSessionByFile(sessionFile: string, leafId?: string | null): Promise<Conversation> {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let conversation = this.conversations.find((c) => c.sessionFile === sessionFile);
    if (!conversation) {
      const opened = await getSessionStore().open(sessionFile, leafId ?? undefined);
      conversation = await this.createConversation({
        sessionFile: opened.sessionFile,
        sessionId: opened.sessionId,
        leafId: opened.leafId,
      });
    }

    await this.loadSdkMessagesForConversation(conversation, leafId);
    return conversation;
  }

  async switchConversation(id: string, leafId?: string | null): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return null;

    await this.loadSdkMessagesForConversation(conversation, leafId);

    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex(c => c.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    this.conversations.splice(index, 1);

    await PiAgentServices
      .getConversationHistoryService()
      .deleteConversationSession(conversation, getVaultPath(this.app));

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.conversationController?.createNew({ force: true });
        }
      }
    }
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();

    await this.persistConversationMeta(conversation);
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    Object.assign(conversation, updates, { updatedAt: Date.now() });

    await this.persistConversationMeta(conversation);

    // Clear image data from memory after save (data is persisted in JSONL).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    if (!PiAgentServices.getConversationHistoryService().isPendingForkConversation(conversation)) {
      for (const msg of conversation.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  async getConversationById(id: string, leafId?: string | null): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id) || null;

    if (conversation) {
      await this.loadSdkMessagesForConversation(conversation, leafId);
    }

    return conversation;
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversations.find(c => c.id === id) || null;
  }

  findEmptyConversation(): Conversation | null {
    return this.conversations.find(c => c.messages.length === 0) || null;
  }

  getConversationList(): ConversationMeta[] {
    return this.conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): ObsiusView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OBSIUS);
    return leaves.map(leaf => leaf.view).find(isObsiusView) ?? null;
  }

  getAllViews(): ObsiusView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OBSIUS);
    return leaves.map(leaf => leaf.view).filter(isObsiusView);
  }

  findConversationAcrossViews(conversationId: string): { view: ObsiusView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
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
