import type { ChatPorts } from '@pivi/obsidian-ui/ports';
import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

import { PluginLogger } from '../../shared/utils/logger';
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
  refreshTabAgentUI,
  resolveBlankTabModel,
} from './tabAgentContext';
import { generateTabMessageId } from './tabAutoTurn';
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
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
    (id) => handleRedoRequest(tab, plugin, id),
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
      plugin,
      state,
      subagentManager: services.subagentManager,
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.richInput,
      getFileContextManager: () => ui.fileContextManager,
      getInlineContextManager: () => ui.inlineContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
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
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig, openSession);

        if (tab.service && openSession) {
          const externalContextPaths = getDefaultExternalContextPaths(plugin.settings);
          tab.ui.externalContextSelector?.resetForSession(externalContextPaths);
          tab.service.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
        }

        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab, ports);
      },
    },
    {
      onNewSession: () => {
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin);
        tab.draftTitle = null;
        tab.openSessionId = null;
        tab.sessionFile = null;
        tab.leafId = null;
        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab, ports);
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig);
      },
      onSessionLoaded: () => ui.slashCommandDropdown?.resetRuntimeSkillsCache(),
      onSessionSwitched: () => ui.slashCommandDropdown?.resetRuntimeSkillsCache(),
    },
  );

  tab.controllers.inputController = new InputController({
    plugin,
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
        await initializeTabService(tab, plugin);
        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab, ports);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : t('chat.errors.initChatService'));
        return false;
      }
    },
    openSession,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, plugin, forkRequestCallback)
      : undefined,
    onTitleChanged,
    getDraftCustomTitle: () => tab.draftTitle,
    clearDraftCustomTitle: () => {
      tab.draftTitle = null;
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.richInput,
    getSettings: () => plugin.settings.keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}
