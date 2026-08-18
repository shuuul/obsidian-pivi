import { recalculateUsageForModel } from '@pivi/agent/foundation/usage';
import type { ChatPorts } from '@pivi/agent/runtime/chatPorts';
import { type Editor, type MarkdownView, type TFile } from 'obsidian';

import type {
  PiviChatCompositionHost,
  PiviChatViewHandle,
} from '@/app/hostContracts';
import {
  runDevelopment20Subagents,
  runDevelopmentIndexedSessionPaging,
  runDevelopmentMarkdownStreamInIsolatedTab,
  runDevelopmentTabSwitching,
} from '@/app/ui/imperativeChatDevelopment';
import { submitInlineEditTurn as runSubmitInlineEditTurn } from '@/app/ui/imperativeChatInlineEdit';
import { imperativeChatLogger } from '@/app/ui/imperativeChatTabAction';
import { refreshBlankTabModelState } from '@/ui/chat/tabs/Tab';
import { syncTabSessionExternalContext } from '@/ui/chat/tabs/tabExternalContext';
import type { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabId } from '@/ui/chat/tabs/types';
import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

export interface ImperativeChatViewHandleDeps {
  getTabManager: () => TabManager | null;
  getMountedPorts: () => ChatPorts | null;
  plugin: PiviChatCompositionHost;
  persistTabStateImmediate: (state: ReturnType<TabManager['getPersistedState']>) => Promise<void>;
  publishTabSnapshot: () => void;
  runWithoutTabPersistence: <T>(action: () => Promise<T>) => Promise<T>;
  syncInputTabBarPortal: (tabId?: TabId | null) => void;
}

export function createImperativeChatViewHandle(
  deps: ImperativeChatViewHandleDeps,
): PiviChatViewHandle {
  const {
    getMountedPorts,
    getTabManager,
    persistTabStateImmediate,
    plugin,
    publishTabSnapshot,
    runWithoutTabPersistence,
    syncInputTabBarPortal,
  } = deps;

  const refreshModelPresentation = (): void => {
    const ports = getMountedPorts();
    if (!ports) return;
    const settings = ports.settings.getSettingsSnapshot();
    const contextWindow = ports.models.getContextWindowSize(
      settings.model,
      settings.customContextLimits,
    );

    for (const tab of getTabManager()?.getAllTabs() ?? []) {
      refreshBlankTabModelState(tab, ports);
      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(
          tab.state.usage,
          settings.model,
          contextWindow,
        );
      }
      tab.ui.composerActions?.refresh();
    }
    getTabManager()?.prefetchSlashCommandCaches();
  };

  return {
    commands: {
      getState: () => {
        const tabManager = getTabManager();
        const activeTab = tabManager?.getActiveTab() ?? null;
        return {
          mounted: tabManager !== null,
          canCreateTab: tabManager?.canCreateTab() ?? false,
          canStartNewSession: !!activeTab && !activeTab.state.isStreaming,
          canCloseActiveTab: activeTab !== null,
        };
      },
      async createTab() {
        const tab = await getTabManager()?.createTab();
        publishTabSnapshot();
        return tab != null;
      },
      async startNewSession() {
        const activeTab = getTabManager()?.getActiveTab() ?? null;
        if (!activeTab || activeTab.state.isStreaming) return false;
        await getTabManager()?.createNewSession();
        return true;
      },
      async openSession(openSessionId) {
        const manager = getTabManager();
        if (!manager) return false;
        await manager.openSession(openSessionId, { preferNewTab: true });
        publishTabSnapshot();
        return true;
      },
      async closeActiveTab() {
        const manager = getTabManager();
        const tabId = manager?.getActiveTabId() ?? null;
        if (!manager || !tabId) return false;
        const closed = await manager.closeTab(tabId);
        publishTabSnapshot();
        return closed;
      },
      cancelActiveTurn() {
        const tab = getTabManager()?.getActiveTab() ?? null;
        if (!tab?.state.isStreaming || !tab.controllers.inputController) return false;
        tab.controllers.inputController.cancelStreaming();
        return true;
      },
      async sendWorkspaceCommandInNewSession(content) {
        const tab = await getTabManager()?.createTab();
        const inputController = tab?.controllers.inputController;
        if (!tab || !inputController) return false;
        await inputController.sendMessage({ content });
        publishTabSnapshot();
        return true;
      },
      async submitInlineEditTurn(params) {
        const manager = getTabManager();
        const ports = getMountedPorts();
        if (!manager || !ports) {
          return null;
        }
        try {
          return await runSubmitInlineEditTurn(manager, ports, params);
        } finally {
          // Transport tab is closed after each turn; refresh so archived rows do not linger.
          publishTabSnapshot();
        }
      },
      addEditorSelection(editor: Editor, markdownView: MarkdownView) {
        return getTabManager()?.getActiveTab()?.ui.inlineContextManager
          ?.addSelectionFromEditor(editor, markdownView) ?? false;
      },
      getActiveExternalContexts() {
        return [
          ...(getTabManager()?.getActiveTab()?.ui.externalContextSelector
            ?.getExternalContexts() ?? []),
        ];
      },
    },
    maintenance: {
      async persistState() {
        const tabManager = getTabManager();
        if (!tabManager) return;
        await persistTabStateImmediate(tabManager.getPersistedState());
      },
      async resetSession(openSessionId) {
        for (const tab of getTabManager()?.getAllTabs() ?? []) {
          if (tab.openSessionId !== openSessionId) continue;
          if (tab.state.isStreaming) {
            tab.controllers.inputController?.cancelStreaming();
          }
          await tab.controllers.openSessionController?.createNew({ force: true });
        }
      },
      getBoundSessionFiles() {
        return [
          ...new Set(
            (getTabManager()?.getAllTabs() ?? [])
              .map(tab => tab.sessionFile)
              .filter((path): path is string => !!path),
          ),
        ];
      },
      hasSession(openSessionId) {
        return (getTabManager()?.getAllTabs() ?? [])
          .some(tab => tab.openSessionId === openSessionId);
      },
      async activateSession(openSessionId) {
        const tabManager = getTabManager();
        const tab = (tabManager?.getAllTabs() ?? [])
          .find(candidate => candidate.openSessionId === openSessionId);
        if (!tab || !tabManager) return false;
        await tabManager.switchToTab(tab.id);
        return true;
      },
      refreshModelPresentation,
      refreshTabBarPosition() {
        syncInputTabBarPortal();
        publishTabSnapshot();
      },
      refreshChatDisplaySettings() {
        const ports = getMountedPorts();
        const snapshot = ports?.settings.getSettingsSnapshot();
        if (!snapshot) return;
        for (const tab of getTabManager()?.getAllTabs() ?? []) {
          tab.state.applyChatDisplaySettings(snapshot);
        }
      },
      async refreshRuntimePrompt() {
        await getTabManager()?.broadcastToAllTabs(async service => {
          if (service.syncSystemPrompt) await service.syncSystemPrompt();
          else await service.ensureReady({ force: true });
        });
        for (const tab of getTabManager()?.getAllTabs() ?? []) {
          tab.ui.composerActions?.refresh();
        }
      },
      async reloadMcpServers() {
        await getTabManager()?.broadcastToAllTabs(service => service.reloadMcpServers());
      },
      async refreshVaultSkills() {
        getTabManager()?.invalidateSlashCommandCaches();
        await getTabManager()?.broadcastToAllTabs(async service => {
          await service.syncSystemPrompt?.();
        });
      },
      async refreshPiviManagement(domain) {
        const failures: Array<{ target: string; message: string }> = [];
        const manager = getTabManager();
        if (!manager) return failures;

        const tabs = manager.getAllTabs();
        const initialized = tabs.filter((tab) => tab.serviceInitialized && tab.service);

        // Always invalidate/warm slash caches for management domains that affect catalogs.
        manager.invalidateSlashCommandCaches();

        for (let index = 0; index < initialized.length; index++) {
          const tab = initialized[index]!;
          const service = tab.service!;
          const target = `tab:${tab.id || String(index + 1)}`;
          try {
            if (domain === 'mcp') {
              await service.reloadMcpServers();
            } else if (domain === 'skills') {
              if (service.syncSystemPrompt) await service.syncSystemPrompt();
              else await service.ensureReady({ force: true });
            }
            // commands: cache invalidation/warm only — no per-tab runtime call.
          } catch (error) {
            imperativeChatLogger.warn(
              `Pivi management ${domain} refresh failed for ${target}`,
              error,
            );
            failures.push({ target, message: 'Runtime refresh failed.' });
          }
        }

        failures.push(...await manager.refreshSlashCommandCachesStrict());
        return failures;
      },
      invalidateSlashCatalog() {
        getTabManager()?.invalidateSlashCommandCaches();
      },
      warmSlashCatalog() {
        getTabManager()?.prefetchSlashCommandCaches();
      },
      syncExternalReadDirectories(paths) {
        getTabManager()?.syncPinnedExternalContextPaths([...paths]);
      },
      async applyEnvironmentRuntimeChange(modelChanged) {
        const tabs = getTabManager()?.getAllTabs() ?? [];
        for (const tab of tabs) {
          if (tab.state.isStreaming) {
            tab.controllers.inputController?.cancelStreaming();
          }
        }

        let failedTabs = 0;
        const defaultExternalContextPaths = getDefaultExternalContextPaths(plugin.settings);
        for (const tab of tabs) {
          const service = tab.service;
          if (!service || !tab.serviceInitialized) continue;
          try {
            syncTabSessionExternalContext(
              tab,
              tab.sessionFile ? { sessionFile: tab.sessionFile } : null,
              defaultExternalContextPaths,
              { service },
            );
            if (modelChanged) {
              service.resetSession();
              await service.ensureReady();
            } else {
              await service.ensureReady({ force: true });
            }
          } catch (error) {
            imperativeChatLogger.warn('tab failed to restart after environment change', error);
            failedTabs++;
          }
        }
        return { failedTabs };
      },
      markFileContextDirty(includesFolders) {
        const manager = getTabManager()?.getActiveTab()?.ui.fileContextManager;
        if (!manager) return;
        manager.markFileCacheDirty();
        if (includesFolders) manager.markFolderCacheDirty();
      },
      handleFileOpen(file: TFile) {
        getTabManager()?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
      },
      dismissMentionDropdown(target: Node) {
        const tab = getTabManager()?.getActiveTab() ?? null;
        const manager = tab?.ui.fileContextManager;
        if (!tab || !manager) return;
        if (!manager.containsElement(target) && target !== tab.dom.richInput.el) {
          manager.hideMentionDropdown();
        }
      },
    },
    ...(process.env.NODE_ENV !== 'production' ? {
      development: {
        async run20SubagentsWorkload(hooks) {
          const manager = getTabManager();
          const activeTab = manager?.getActiveTab();
          const ownerWindow = activeTab?.dom.messagesEl.ownerDocument.defaultView;
          if (!manager || !ownerWindow) {
            throw new Error('A mounted active chat is required for the 20-subagent workload.');
          }
          return runWithoutTabPersistence(
            () => runDevelopment20Subagents(manager, ownerWindow, plugin, hooks),
          );
        },
        async runIndexedSessionPagingWorkload(hooks) {
          const manager = getTabManager();
          const activeTab = manager?.getActiveTab();
          const ownerWindow = activeTab?.dom.messagesEl.ownerDocument.defaultView;
          if (!manager || !ownerWindow) {
            throw new Error('A mounted active chat is required for the indexed paging workload.');
          }
          return runWithoutTabPersistence(
            () => runDevelopmentIndexedSessionPaging(manager, ownerWindow, plugin, hooks),
          );
        },
        async run100KbMarkdownStream() {
          const manager = getTabManager();
          if (!manager?.getActiveTab()) {
            throw new Error('A mounted active chat is required for the Markdown performance stream.');
          }
          return runWithoutTabPersistence(
            () => runDevelopmentMarkdownStreamInIsolatedTab(manager),
          );
        },
        async runTabSwitchingWorkload() {
          const manager = getTabManager();
          const activeTab = manager?.getActiveTab();
          const ownerWindow = activeTab?.dom.messagesEl.ownerDocument.defaultView;
          if (!manager || !ownerWindow) {
            throw new Error('A mounted active chat is required for the tab switching workload.');
          }
          return runWithoutTabPersistence(
            () => runDevelopmentTabSwitching(manager, ownerWindow),
          );
        },
      },
    } : {}),
  };
}
