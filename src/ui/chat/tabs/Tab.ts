import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';

import type { PiviChatHost } from "@/app/hostContracts";

import { SubagentManager } from "../services/SubagentManager";
import { ChatState } from '../state/ChatState';
import {
  applyCapabilityUIGating,
  getTabHiddenCommands,
  resolveBlankTabModel,
} from "./tabAgentContext";
import { initializeContextManagers } from "./tabContextInit";
import { buildTabDOM } from "./tabDom";
import { wireMessageViewport } from './tabMessageViewport';
import {
  type SlashCatalogInfo,
} from "./tabSlashCatalog";
import { initializeSlashCommands } from "./tabSlashInit";
import { initializeTitleGeneration } from "./tabTitleGeneration";
import { wireComposerChrome } from "./tabToolbarInit";
import type { TabData, TabId } from "./types";
import { generateTabId } from "./types";

export interface TabCreateOptions {
  plugin: PiviChatHost;
  ports: ChatPorts;

  containerEl: HTMLElement;
  openSession?: OpenSessionState;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  /** Restored custom title for blank tabs (before session bind). */
  draftTitle?: string | null;
  isArchived?: boolean;
  needsAttention?: boolean;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onOpenSessionIdChanged?: (openSessionId: string | null) => void;
}

/** Refreshes blank-tab model options after settings or environment changes. */
export function refreshBlankTabModelState(
  tab: TabData,
  ports: ChatPorts,
): void {
  if (tab.lifecycleState !== "blank") return;

  const settingsSnapshot = ports.settings.getSettingsSnapshot();

  if (tab.draftModel) {
    const fallbackModels = ports.models.getModelOptions(settingsSnapshot);
    if (!fallbackModels.some((model) => model.value === tab.draftModel)) {
      tab.draftModel = fallbackModels[0]?.value ?? tab.draftModel;
    }
  }

  tab.ui.slashCommandDropdown?.setHiddenCommands(
    getTabHiddenCommands(tab, ports.settings),
  );
  tab.ui.slashCommandDropdown?.resetRuntimeSkillsCache();
  tab.ui.composerActions?.refresh();
  applyCapabilityUIGating(tab, ports);
}

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    plugin,
    containerEl,
    openSession,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onOpenSessionIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({
    cls: "pivi-tab-content pivi-hidden",
  });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onOpenSessionChanged: onOpenSessionIdChanged,
  });

  const subagentManager = new SubagentManager(() => {});

  const dom = buildTabDOM(contentEl, plugin.app);
  dom.composerPortalEl.dataset.tabId = id;

  const isBound = !!openSession?.id;
  const restoredDraftModel =
    typeof options.draftModel === "string" ? options.draftModel.trim() : "";
  const draftModel = isBound
    ? null
    : restoredDraftModel || resolveBlankTabModel(options.ports);
  const restoredDraftTitle =
    typeof options.draftTitle === "string" ? options.draftTitle.trim() : "";
  const draftTitle = isBound ? null : restoredDraftTitle || null;

  const tab: TabData = {
    id,
    lifecycleState: isBound ? "bound_cold" : "blank",
    draftModel,
    draftTitle,
    openSessionId: openSession?.id ?? null,
    sessionFile: openSession?.sessionFile ?? null,
    leafId: openSession?.leafId ?? null,
    service: null,
    isArchived: options.isArchived ?? false,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      openSessionController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager,

      titleGenerationService: null,
    },
    ui: {
      fileContextManager: null,
      inlineContextManager: null,
      imageContextManager: null,
      externalContextSelector: null,
      slashCommandDropdown: null,
      composerActions: null,
    },
    dom,
    renderer: null,
  };

  state.needsAttention = options.needsAttention ?? false;
  state.callbacks = {
    ...state.callbacks,
    onAttentionChanged,
  };

  return tab;
}

export interface InitializeTabUIOptions {
  ports: ChatPorts;
  getSlashCatalogConfig?: () => SlashCatalogInfo;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  plugin: PiviChatHost,
  options: InitializeTabUIOptions,
): void {
  const { dom, state } = tab;
  const { ports } = options;

  initializeContextManagers(tab, plugin, ports);

  dom.selectionIndicatorEl = dom.contextRowEl.createDiv({
    cls: "pivi-selection-indicator pivi-hidden",
  });

  dom.browserIndicatorEl = dom.contextRowEl.createDiv({
    cls: "pivi-browser-selection-indicator pivi-hidden",
  });

  dom.canvasIndicatorEl = dom.contextRowEl.createDiv({
    cls: "pivi-canvas-indicator pivi-hidden",
  });

  const catalogInfo = options.getSlashCatalogConfig?.() ?? null;
  initializeSlashCommands(
    tab,
    ports,
    () => getTabHiddenCommands(tab, ports.settings),
    catalogInfo,
  );

  dom.eventCleanups.push(wireMessageViewport({
    messagesEl: dom.messagesEl,
    messagesPortalEl: dom.messagesPortalEl,
    state,
  }));

  initializeTitleGeneration(tab, ports);
  wireComposerChrome(tab, plugin, ports, options.getSlashCatalogConfig);
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass("pivi-hidden");
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  tab.state.navigationVisible = tab.dom.messagesEl.scrollHeight > tab.dom.messagesEl.clientHeight + 50;
}

/**
 * Deactivates a tab (hides it and stops services).
 */
export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.addClass("pivi-hidden");
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 */
export function destroyTab(tab: TabData): Promise<void> {
  tab.lifecycleState = "closing";

  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.browserSelectionController?.clear();
  tab.controllers.canvasSelectionController?.stop();
  tab.controllers.canvasSelectionController?.clear();
  tab.controllers.navigationController?.dispose();
  tab.controllers.streamController?.dispose();


  tab.controllers.inputController?.dismissPendingInlinePrompts();

  tab.ui.fileContextManager?.destroy();
  tab.ui.inlineContextManager?.destroy();
  tab.ui.composerActions = null;
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;

  tab.services.titleGenerationService?.cancel();
  tab.services.titleGenerationService = null;

  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();
  tab.state.flushProjection();
  tab.state.projectionStore.dispose();

  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
  return Promise.resolve();
}
