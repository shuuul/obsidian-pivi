import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { Component } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';

import { resolveComposerWorkspaceCommand } from '../composer/ComposerWorkspaceCommand';
import { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import { InputController } from '../controllers/InputController';
import { NavigationController } from '../controllers/NavigationController';
import { SelectionController } from '../controllers/SelectionController';
import { SessionController } from '../controllers/SessionController';
import { StreamController } from '../controllers/StreamController';
import { MessageRenderer } from '../rendering/MessageRenderer';
import { autoResizeTextarea } from '../ui/textareaResize';
import {
  applyCapabilityUIGating,
  cleanupTabRuntime,
  resolveBlankTabModel,
} from './tabAgentContext';
import { generateTabMessageId } from './tabAutoTurn';
import { syncTabSessionExternalContext } from './tabExternalContext';
import { type ForkContext,handleForkAll, handleForkRequest } from './tabFork';
import { handleRedoRequest } from './tabRedo';
import { initializeTabService } from './tabRuntime';
import { type SlashCatalogInfo,syncSlashCommandDropdown } from './tabSlashCatalog';
import type { TabData } from './types';

const logger = new PluginLogger('tabControllerInit');

function shouldPersistAsyncSubagentState(subagent: SubagentInfo): boolean {
  const status = subagent.asyncStatus ?? subagent.status;
  return status === 'completed' || status === 'error' || status === 'orphaned';
}

/** Wire per-tab controllers after DOM and base tab state exist. */
export function initializeTabControllers(
  tab: TabData,
  plugin: PiviChatHost,
  component: Component,
  ports: ChatPorts,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openSession?: (openSessionId: string) => Promise<void>,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
  onTitleChanged?: (title: string) => void,
): void {
  const { dom, state, services, ui } = tab;

  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesPortalEl,
    ports,
    forkRequestCallback
      ? (id) => handleForkRequest(tab, ports.sessions, id, forkRequestCallback)
      : undefined,
    (id) => handleRedoRequest(tab, plugin, ports, id),
  );

  tab.controllers.selectionController = new SelectionController(
    plugin.app,
    dom.selectionIndicatorEl!,
    dom.richInput.el,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.richInput.el),
    dom.contentEl,
  );

  tab.controllers.browserSelectionController = new BrowserSelectionController(
    plugin.app,
    dom.browserIndicatorEl!,
    dom.richInput.el,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.richInput.el),
  );

  tab.controllers.canvasSelectionController = new CanvasSelectionController(
    plugin.app,
    dom.canvasIndicatorEl!,
    dom.richInput.el,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.richInput.el),
  );

  tab.controllers.streamController = new StreamController({
    plugin,
    settings: ports.settings,
    state,
    renderer: tab.renderer,
    subagentManager: services.subagentManager,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
    getAgentService: () => tab.service,
  });

  services.subagentManager.setCallback((subagent) => {
    tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);

    if (
      !tab.state.isStreaming
      && tab.state.currentOpenSessionId
      && shouldPersistAsyncSubagentState(subagent)
    ) {
      void tab.controllers.openSessionController?.save(false).catch((err) => {
        logger.warn('Failed to save session during subagent state change', err);
      });
    }
  });

  tab.controllers.openSessionController = new SessionController(
    {
      settings: ports.settings,
      sessions: ports.sessions,
      state,
      subagentManager: services.subagentManager,
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.richInput,
      getFileContextManager: () => ui.fileContextManager,
      getInlineContextManager: () => ui.inlineContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessages: () => tab.controllers.inputController?.clearQueuedMessages(),
      resetStreamingState: () => tab.controllers.streamController?.resetStreamingState(),
      getAgentService: () => tab.service,
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingInlinePrompts(),
      ensureServiceForSession: (openSession) => {
        tab.openSessionId = openSession?.id ?? null;
        tab.sessionFile = openSession?.sessionFile ?? null;
        tab.leafId = null;
        tab.draftModel = null;
        if (!openSession) {
          tab.draftTitle = null;
        }
        tab.lifecycleState = openSession ? 'bound_cold' : 'blank';
        syncSlashCommandDropdown(
          tab,
          ports.settings,
          getSlashCatalogConfig,
          openSession,
        );

        if (tab.service && openSession) {
          syncTabSessionExternalContext(
            tab,
            { sessionFile: openSession.sessionFile ?? null },
            ports.settings.getSettingsSnapshot().externalReadDirectories,
            { resetSelection: true },
          );
        }

        tab.ui.composerActions?.refresh();
        applyCapabilityUIGating(tab, ports);
      },
    },
    {
      onNewSession: () => {
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(ports);
        tab.draftTitle = null;
        tab.openSessionId = null;
        tab.sessionFile = null;
        tab.leafId = null;
        tab.ui.composerActions?.refresh();
        applyCapabilityUIGating(tab, ports);
        syncSlashCommandDropdown(tab, ports.settings, getSlashCatalogConfig);
      },
      onSessionLoaded: () => ui.slashCommandDropdown?.resetRuntimeSkillsCache(),
      onSessionSwitched: () => ui.slashCommandDropdown?.resetRuntimeSkillsCache(),
    },
  );

  tab.controllers.inputController = new InputController({
    plugin,
    settings: ports.settings,
    sessions: ports.sessions,
    state,
    renderer: tab.renderer,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    browserSelectionController: tab.controllers.browserSelectionController,
    canvasSelectionController: tab.controllers.canvasSelectionController,
    openSessionController: tab.controllers.openSessionController,
    getInputEl: () => dom.richInput,
    getInputContainerEl: () => dom.inputContainerEl,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    getInlineContextManager: () => ui.inlineContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getExternalContextSelector: () => ui.externalContextSelector,
    getTitleGenerationService: () => services.titleGenerationService,
    generateId: generateTabMessageId,
    resetInputHeight: () => {},
    getAuxiliaryModel: () => tab.service?.getAuxiliaryModel?.() ?? tab.draftModel ?? null,
    getAgentService: () => tab.service,
    getSubagentManager: () => services.subagentManager,
    ensureServiceInitialized: async () => {
      if (tab.serviceInitialized && tab.lifecycleState === 'bound_active') {
        return true;
      }

      try {
        await initializeTabService(tab, ports);
        tab.ui.composerActions?.refresh();
        applyCapabilityUIGating(tab, ports);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : t('chat.errors.initChatService'));
        return false;
      }
    },
    openSession,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, ports.sessions, forkRequestCallback)
      : undefined,
    onTitleChanged,
    getDraftCustomTitle: () => tab.draftTitle,
    clearDraftCustomTitle: () => {
      tab.draftTitle = null;
    },
    resolveWorkspaceCommand: async (content) => {
      const catalogInfo = getSlashCatalogConfig?.();
      const entries = catalogInfo ? await catalogInfo.getEntries() : [];
      const resolved = await resolveComposerWorkspaceCommand(content, entries, async () => {
        const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const file = activeView?.file;
        return {
          selectedText: tab.controllers.selectionController?.getContext()?.selectedText ?? '',
          selectedTextContext:
            tab.controllers.selectionController?.getInlineContextReference() ?? null,
          currentNote: file ? await plugin.app.vault.read(file) : '',
          currentNoteName: file?.basename ?? '',
          date: new Date().toLocaleDateString(),
        };
      });
      if (resolved.missingSelectedText) {
        new Notice(t('chat.errors.noTextSelected'));
        return null;
      }
      return {
        displayContent: resolved.displayContent,
        promptContent: resolved.promptContent,
      };
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.richInput,
    getSettings: () => ports.settings.getSettingsSnapshot().keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}
