import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';

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
  plugin: PiviPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openSession?: (openSessionId: string) => Promise<void>,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom, state, services, ui } = tab;

  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesEl,
    forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
  );
  services.subagentManager.setRenderContent((el, markdown) => tab.renderer!.renderContent(el, markdown));

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
      renderer: tab.renderer,
      subagentManager: services.subagentManager,
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.richInput,
      getFileContextManager: () => ui.fileContextManager,
      getInlineContextManager: () => ui.inlineContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getStatusPanel: () => ui.statusPanel,
      getAgentService: () => tab.service,
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingInlinePrompts(),
      ensureServiceForSession: (openSession) => {
        tab.openSessionId = openSession?.id ?? null;
        tab.sessionFile = openSession?.sessionFile ?? null;
        tab.leafId = null;
        tab.draftModel = null;
        tab.lifecycleState = openSession ? 'bound_cold' : 'blank';
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig, openSession);

        if (tab.service && openSession) {
          const hasMessages = openSession.messages.length > 0;
          const externalContextPaths = hasMessages
            ? openSession.externalContextPaths || []
            : (plugin.settings.persistentExternalContextPaths || []);
          tab.service.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
        }

        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab, plugin);
      },
    },
    {
      onNewSession: () => {
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin);
        tab.openSessionId = null;
        tab.sessionFile = null;
        tab.leafId = null;
        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab, plugin);
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
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    getInlineContextManager: () => ui.inlineContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getMcpServerSelector: () => ui.mcpServerSelector,
    getExternalContextSelector: () => ui.externalContextSelector,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => ui.statusPanel,
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
        applyCapabilityUIGating(tab, plugin);
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
