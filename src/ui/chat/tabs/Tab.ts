import { piChatUIConfig } from '@pivi/pivi-agent-core/engine/pi/piChatUiConfig';
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
// TODO(ui-package): move chat UI config types behind an @pivi package API.
import type { ChatUIOption } from '@pivi/pivi-agent-core/foundation/chatUi';

import type PiviPlugin from "@/app/PiviPluginHost";

import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { SubagentManager } from "../services/SubagentManager";
import { ChatState } from '../state/ChatState';
import { NavigationSidebar } from "../ui/NavigationSidebar";
import {
  applyCapabilityUIGating,
  getTabHiddenCommands,
  refreshTabAgentUI,
  resolveBlankTabModel,
} from "./tabAgentContext";
import { initializeContextManagers } from "./tabContextInit";
import { buildTabDOM } from "./tabDom";
import { initializeInstructionAndTodo } from "./tabInstructionTodo";
import {
  type SlashCatalogInfo,
} from "./tabSlashCatalog";
import { initializeSlashCommands } from "./tabSlashInit";
import { initializeInputToolbar } from "./tabToolbarInit";
import type { TabData, TabId } from "./types";
import { generateTabId } from "./types";

export { initializeTabControllers } from "./tabControllerInit";
export type { ForkContext } from "./tabFork";
export { wireTabInputEvents } from "./tabInputWiring";
export { updatePlanModeUI } from "./tabPlanMode";
export { initializeTabService } from "./tabRuntime";

/**
 * Returns model options for a blank tab.
 * Uses provider registration metadata to determine which providers are
 * available and how they should appear in the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ChatUIOption[] {
  return piChatUIConfig.getModelOptions(settings);
}

export interface TabCreateOptions {
  plugin: PiviPlugin;

  containerEl: HTMLElement;
  openSession?: OpenSessionState;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  isArchived?: boolean;
  needsAttention?: boolean;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onOpenSessionIdChanged?: (openSessionId: string | null) => void;
}

/** Refreshes blank-tab model options after settings or environment changes. */
export function refreshBlankTabModelState(
  tab: TabData,
  plugin: PiviPlugin,
): void {
  if (tab.lifecycleState !== "blank") return;

  const settingsSnapshot = plugin.settings as unknown as Record<
    string,
    unknown
  >;

  if (tab.draftModel) {
    const fallbackModels = piChatUIConfig.getModelOptions(settingsSnapshot);
    if (!fallbackModels.some((model) => model.value === tab.draftModel)) {
      tab.draftModel = fallbackModels[0]?.value ?? tab.draftModel;
    }
  }

  tab.ui.slashCommandDropdown?.setHiddenCommands(
    getTabHiddenCommands(tab, plugin),
  );
  tab.ui.slashCommandDropdown?.resetRuntimeSkillsCache();
  refreshTabAgentUI(tab, plugin);
  applyCapabilityUIGating(tab, plugin);
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
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!openSession?.id;
  const restoredDraftModel =
    typeof options.draftModel === "string" ? options.draftModel.trim() : "";
  const draftModel = isBound
    ? null
    : restoredDraftModel || resolveBlankTabModel(plugin);

  const tab: TabData = {
    id,
    lifecycleState: isBound ? "bound_cold" : "blank",
    draftModel,
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
      modelSelector: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      slashCommandDropdown: null,
      contextUsageMeter: null,
      sendButton: null,
      statusPanel: null,
      navigationSidebar: null,
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
  getSlashCatalogConfig?: () => SlashCatalogInfo;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  plugin: PiviPlugin,
  options: InitializeTabUIOptions = {},
): void {
  const { dom, state } = tab;

  initializeContextManagers(tab, plugin);

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
    plugin,
    () => getTabHiddenCommands(tab, plugin),
    catalogInfo,
  );

  if (dom.messagesEl.parentElement) {
    tab.ui.navigationSidebar = new NavigationSidebar(
      dom.messagesEl.parentElement,
      dom.messagesEl,
    );
  }

  initializeInstructionAndTodo(tab, plugin);
  initializeInputToolbar(tab, plugin, options.getSlashCatalogConfig);

  const priorStreamingChanged = state.callbacks.onStreamingStateChanged;
  state.callbacks = {
    ...state.callbacks,
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
    },
    onTodoVisualizationChanged: (model) => tab.ui.statusPanel?.updateTodoVisualization(model),
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
    onStreamingStateChanged: (isStreaming) => {
      tab.ui.sendButton?.update();
      priorStreamingChanged?.(isStreaming);
    },
  };

  const resizeObserver = new ResizeObserver(() => {
    tab.ui.navigationSidebar?.updateVisibility();
  });
  resizeObserver.observe(dom.messagesEl);
  dom.eventCleanups.push(() => resizeObserver.disconnect());
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass("pivi-hidden");
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  tab.ui.navigationSidebar?.updateVisibility();
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

  cleanupThinkingBlock(tab.state.currentThinkingState);
  tab.state.currentThinkingState = null;

  tab.controllers.inputController?.dismissPendingApproval();

  tab.ui.fileContextManager?.destroy();
  tab.ui.inlineContextManager?.destroy();
  tab.ui.sendButton?.destroy();
  tab.ui.sendButton = null;
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;

  tab.services.titleGenerationService?.cancel();
  tab.services.titleGenerationService = null;
  tab.ui.statusPanel?.destroy();
  tab.ui.statusPanel = null;
  tab.ui.navigationSidebar?.destroy();
  tab.ui.navigationSidebar = null;

  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();

  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
  return Promise.resolve();
}

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: PiviPlugin): string {
  if (tab.openSessionId) {
    const openSession = plugin.getOpenSessionSync(tab.openSessionId);
    if (openSession?.title) {
      return openSession.title;
    }
  }
  return "New Chat";
}