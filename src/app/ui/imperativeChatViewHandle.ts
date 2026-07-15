import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { recalculateUsageForModel } from '@pivi/pivi-agent-core/foundation/usage';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { type Editor, type MarkdownView, type TFile } from 'obsidian';

import type {
  PiviChatCompositionHost,
  PiviChatDevelopmentCommands,
  PiviChatViewHandle,
} from '@/app/hostContracts';
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

const DEVELOPMENT_MARKDOWN_BYTES = 100 * 1024;
const DEVELOPMENT_MARKDOWN_CHUNK_BYTES = 1_600;
const DEVELOPMENT_MARKDOWN_SETTLE_MS = 750;
const DEVELOPMENT_PAGING_FIXTURE = '.pivi/sessions/perf-002-5k-messages.jsonl';
const DEVELOPMENT_PAGING_SETTLE_MS = 750;
const DEVELOPMENT_SWITCHING_MESSAGE_COUNT = 100;
const DEVELOPMENT_SWITCHING_PASSES = 2;
const DEVELOPMENT_SWITCHING_TAB_COUNT = 10;

type DevelopmentMarkdownStreamState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage(message: ChatMessage): void;
  notifyMessageChanged(message: ChatMessage): void;
  flushProjection(): void;
};

function createDevelopmentMarkdown(): string {
  const heading = '# Deterministic streaming Markdown\n\n';
  const paragraph = [
    '## Stable section\n\n',
    'This paragraph contains **bold text**, `inline code`, a ',
    '[link](https://example.com), and stable prose for real Obsidian rendering.\n\n',
  ].join('');
  let markdown = heading;
  while (markdown.length + paragraph.length <= DEVELOPMENT_MARKDOWN_BYTES) {
    markdown += paragraph;
  }
  return markdown.padEnd(DEVELOPMENT_MARKDOWN_BYTES, 'x');
}

function nextAnimationFrame(ownerWindow: Window): Promise<void> {
  return new Promise(resolve => ownerWindow.requestAnimationFrame(() => resolve()));
}

async function settleDevelopmentRender(ownerWindow: Window, durationMs: number): Promise<void> {
  await nextAnimationFrame(ownerWindow);
  await nextAnimationFrame(ownerWindow);
  await new Promise(resolve => ownerWindow.setTimeout(resolve, durationMs));
}

async function waitForDevelopmentMessageCount(
  ownerWindow: Window,
  getCount: () => number,
  minimum: number,
): Promise<void> {
  const deadline = ownerWindow.performance.now() + 5_000;
  while (getCount() < minimum) {
    if (ownerWindow.performance.now() >= deadline) {
      throw new Error('Timed out waiting for the indexed older page to render.');
    }
    await new Promise(resolve => ownerWindow.setTimeout(resolve, 16));
  }
}

async function createDevelopmentPagingFixture(
  plugin: PiviChatCompositionHost,
  runId: number,
): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const source = await adapter.read(DEVELOPMENT_PAGING_FIXTURE);
  const lineEnd = source.indexOf('\n');
  if (lineEnd < 0) {
    throw new Error('The indexed paging fixture has no JSONL entries.');
  }
  const header = JSON.parse(source.slice(0, lineEnd)) as Record<string, unknown>;
  if (header.type !== 'session') {
    throw new Error('The indexed paging fixture has no session header.');
  }
  header.id = `pivi-development-indexed-paging-${runId}`;
  const sessionFile = `.pivi/sessions/perf-isolated-${runId}.jsonl`;
  await adapter.write(sessionFile, `${JSON.stringify(header)}${source.slice(lineEnd)}`);
  return sessionFile;
}

async function removeDevelopmentPagingFixture(
  plugin: PiviChatCompositionHost,
  sessionFile: string,
): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const indexFile = `${sessionFile}.pivi-index`;
  if (await adapter.exists(indexFile)) await adapter.remove(indexFile);
  if (await adapter.exists(sessionFile)) await adapter.remove(sessionFile);
}

async function runDevelopmentIndexedSessionPaging(
  manager: TabManager,
  ownerWindow: Window,
  plugin: PiviChatCompositionHost,
  hooks: Parameters<PiviChatDevelopmentCommands['runIndexedSessionPagingWorkload']>[0],
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['runIndexedSessionPagingWorkload']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the indexed paging workload.');
  }

  const runId = Date.now();
  const tabId = `pivi-development-indexed-paging-${runId}`;
  const sessionFile = await createDevelopmentPagingFixture(plugin, runId);
  try {
    const tab = await manager.createTab(undefined, tabId, {
      sessionFile,
    });
    if (!tab || tab.id !== tabId) {
      throw new Error('Failed to create the isolated indexed paging tab.');
    }
    await settleDevelopmentRender(ownerWindow, DEVELOPMENT_PAGING_SETTLE_MS);
    const initialMessages = tab.state.messages.length;
    await hooks.afterColdOpen();

    const messagesEl = tab.dom.messagesEl;
    messagesEl.scrollTop = 0;
    messagesEl.dispatchEvent(new Event('scroll'));
    await waitForDevelopmentMessageCount(
      ownerWindow,
      () => tab.state.messages.length,
      initialMessages + 1,
    );
    await settleDevelopmentRender(ownerWindow, DEVELOPMENT_PAGING_SETTLE_MS);
    const messagesAfterPrepend = tab.state.messages.length;
    await hooks.afterOlderPage();
    return { initialMessages, messagesAfterPrepend };
  } finally {
    try {
      if (manager.getTab(originalTabId)) {
        await manager.switchToTab(originalTabId);
      }
      if (manager.getTab(tabId)) {
        await manager.closeTab(tabId, true);
      }
    } finally {
      await removeDevelopmentPagingFixture(plugin, sessionFile);
    }
  }
}

function createDevelopmentTabMessages(tabIndex: number): ChatMessage[] {
  return Array.from({ length: DEVELOPMENT_SWITCHING_MESSAGE_COUNT }, (_, messageIndex) => ({
    id: `pivi-development-tab-${tabIndex}-message-${messageIndex}`,
    role: messageIndex % 2 === 0 ? 'user' : 'assistant',
    content: `## Tab ${tabIndex + 1}\n\nDeterministic message ${messageIndex + 1}.`,
    timestamp: messageIndex + 1,
  }));
}

/** Creates, switches, and removes ten in-memory tabs without binding session files. */
export async function runDevelopmentTabSwitching(
  manager: TabManager,
  ownerWindow: Window,
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['runTabSwitchingWorkload']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the switching workload.');
  }

  const runId = Date.now();
  const tabIds: TabId[] = [];
  let switches = 0;
  let startedAt = 0;

  try {
    for (let index = 0; index < DEVELOPMENT_SWITCHING_TAB_COUNT; index += 1) {
      const tabId = `pivi-development-tab-switch-${runId}-${index}`;
      const tab = await manager.createTab(undefined, tabId, {
        activate: false,
        draftTitle: `Performance tab ${index + 1}`,
      });
      if (!tab) throw new Error(`Failed to create development tab ${index + 1}.`);
      tab.state.messages = createDevelopmentTabMessages(index);
      tabIds.push(tab.id);
    }

    await nextAnimationFrame(ownerWindow);
    startedAt = ownerWindow.performance.now();
    for (let pass = 0; pass < DEVELOPMENT_SWITCHING_PASSES; pass += 1) {
      for (const tabId of tabIds) {
        await manager.switchToTab(tabId);
        switches += 1;
        await nextAnimationFrame(ownerWindow);
        await nextAnimationFrame(ownerWindow);
      }
    }

    return {
      tabs: tabIds.length,
      switches,
      durationMs: ownerWindow.performance.now() - startedAt,
    };
  } finally {
    if (manager.getTab(originalTabId)) {
      await manager.switchToTab(originalTabId);
    }
    for (const tabId of [...tabIds].reverse()) {
      await manager.closeTab(tabId, true);
    }
  }
}

/** Drives the real active-tab projection and Markdown adapter without invoking a model. */
export async function runDevelopmentMarkdownStream(
  state: DevelopmentMarkdownStreamState,
  ownerWindow: Window,
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['run100KbMarkdownStream']>>> {
  if (state.isStreaming) {
    throw new Error('Cannot run the Markdown performance stream while a turn is active.');
  }
  const originalMessages = state.messages;
  const originalStreaming = state.isStreaming;
  const markdown = createDevelopmentMarkdown();
  const turnId = Date.now();
  const userMessage: ChatMessage = {
    id: `pivi-development-markdown-stream-user-${turnId}`,
    role: 'user',
    content: 'Render the deterministic 100 KB Markdown stream.',
    timestamp: turnId,
  };
  const message: ChatMessage = {
    id: `pivi-development-markdown-stream-assistant-${turnId}`,
    role: 'assistant',
    content: '',
    contentBlocks: [{ type: 'text', content: '' }],
    timestamp: Date.now(),
  };
  const startedAt = ownerWindow.performance.now();
  let chunks = 0;

  try {
    state.isStreaming = true;
    state.addMessage(userMessage);
    state.addMessage(message);
    await nextAnimationFrame(ownerWindow);

    for (let offset = 0; offset < markdown.length; offset += DEVELOPMENT_MARKDOWN_CHUNK_BYTES) {
      const chunk = markdown.slice(offset, offset + DEVELOPMENT_MARKDOWN_CHUNK_BYTES);
      message.content += chunk;
      const block = message.contentBlocks?.[0];
      if (!block || block.type !== 'text') {
        throw new Error('Development Markdown stream lost its text block.');
      }
      block.content = message.content;
      state.notifyMessageChanged(message);
      chunks += 1;
      await nextAnimationFrame(ownerWindow);
    }

    state.flushProjection();
    await nextAnimationFrame(ownerWindow);
    state.isStreaming = false;
    await new Promise(resolve => ownerWindow.setTimeout(resolve, DEVELOPMENT_MARKDOWN_SETTLE_MS));
    return {
      bytes: markdown.length,
      chunks,
      durationMs: ownerWindow.performance.now() - startedAt,
    };
  } finally {
    state.messages = originalMessages;
    state.isStreaming = originalStreaming;
  }
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
      addEditorSelection(editor: Editor, markdownView: MarkdownView) {
        return getTabManager()?.getActiveTab()?.ui.inlineContextManager
          ?.addSelectionFromEditor(editor, markdownView) ?? false;
      },
      getInlineEditModel() {
        const tab = getTabManager()?.getActiveTab() ?? null;
        return tab?.service?.getAuxiliaryModel?.() ?? tab?.draftModel ?? null;
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
      async refreshRuntimePrompt() {
        await getTabManager()?.broadcastToAllTabs(async service => {
          if (service.syncSystemPrompt) await service.syncSystemPrompt();
          else await service.ensureReady({ force: true });
        });
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
          const activeTab = getTabManager()?.getActiveTab();
          const state = activeTab?.state;
          const ownerWindow = activeTab?.dom.messagesEl.ownerDocument.defaultView;
          if (!state || !ownerWindow) {
            throw new Error('A mounted active chat is required for the Markdown performance stream.');
          }
          return runDevelopmentMarkdownStream(state, ownerWindow);
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
