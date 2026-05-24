import type { Component } from 'obsidian';
import { Notice, Platform } from 'obsidian';

import { AgentServices } from '../../../core/agent/AgentServices';
import { AgentSettingsCoordinator } from '../../../core/agent/AgentSettingsCoordinator';
import { AgentWorkspace } from '../../../core/agent/AgentWorkspace';
import { getHiddenSlashCommandSet } from '../../../core/agent/commands/hiddenCommands';
import type { SlashCommandDropdownConfig } from '../../../core/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../../core/agent/commands/SlashCommandEntry';
import type {
  ChatUIConfig,
  ChatUIOption,
  RuntimeCapabilities,
} from '../../../core/agent/types';
import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import type { ChatMessage, Conversation, ObsiusSettings, StreamChunk } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ObsiusPlugin from '../../../main';
import { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import { ConversationController } from '../controllers/ConversationController';
import { InputController } from '../controllers/InputController';
import { NavigationController } from '../controllers/NavigationController';
import { SelectionController } from '../controllers/SelectionController';
import { StreamController } from '../controllers/StreamController';
import { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { findRewindContext } from '../rewind';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { FileContextManager } from '../ui/FileContext';
import { ImageContextManager } from '../ui/ImageContext';
import { createInputToolbar } from '../ui/InputToolbar';
import { InstructionModeManager as InstructionModeManagerClass } from '../ui/InstructionModeManager';
import { NavigationSidebar } from '../ui/NavigationSidebar';
import { StatusPanel } from '../ui/StatusPanel';
import { autoResizeTextarea } from '../ui/textareaResize';
import { recalculateUsageForModel } from '../utils/usageInfo';
import { initializeTabService } from './tabRuntime';
import type { TabAgentContext, TabData, TabDOMElements, TabId } from './types';
import { generateTabId } from './types';

export { initializeTabService } from './tabRuntime';

type TabAgentSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

/**
 * Returns model options for a blank tab.
 * Uses provider registration metadata to determine which providers are
 * available and how they should appear in the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ChatUIOption[] {
  const uiConfig = AgentServices.getChatUIConfig();
  const chatIcon = uiConfig.getChatIcon?.() ?? undefined;
  const group = AgentServices.getDisplayName();

  return uiConfig.getModelOptions(settings)
    .map(model => ({ ...model, group, chatIcon }));
}

/**
 * Resolves the draft model for a new blank tab by projecting adaptor-specific
 * saved settings. Without this, `plugin.settings.model` reflects only the
 * settings-provider's model, which may belong to a different provider.
 */
function resolveBlankTabModel(plugin: ObsiusPlugin): string {
  const snapshot = AgentSettingsCoordinator.getAgentSettingsSnapshot(
    plugin.settings as unknown as Record<string, unknown>,
  );
  return snapshot.model as string;
}

export interface TabCreateOptions {
  plugin: ObsiusPlugin;

  containerEl: HTMLElement;
  conversation?: Conversation;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
}

function getTabCapabilities(tab: TabAgentContext): RuntimeCapabilities {
  return tab.service?.getCapabilities() ?? AgentServices.getCapabilities();
}

function getTabChatUIConfig(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
  conversation?: Conversation | null,
): ChatUIConfig {
  return AgentServices.getChatUIConfig();
}

function getTabSettingsSnapshot(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
): TabAgentSettings {
  return AgentSettingsCoordinator.getAgentSettingsSnapshot(
    plugin.settings,
  );
}

function getTabPermissionMode(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === 'string' && permissionMode
    ? permissionMode
    : 'normal';
}

function getTabHiddenCommands(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
  conversation?: Conversation | null,
): Set<string> {
  return getHiddenSlashCommandSet(plugin.settings);
}

function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<ObsiusSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {
    return false;
  }

  if (settings.requireCommandOrControlEnterToSend !== true) {
    return true;
  }

  if (Platform.isMacOS) {
    return e.metaKey === true && !e.ctrlKey && !e.altKey;
  }

  return e.ctrlKey === true && !e.metaKey && !e.altKey;
}

type SlashCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCatalogEntry[]>;
} | null;

function syncSlashCommandDropdown(
  tab: TabData,
  plugin: ObsiusPlugin,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
  conversation?: Conversation | null,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) {
    return;
  }

  const catalogInfo = getSlashCatalogConfig?.();

  if (catalogInfo) {
    dropdown.setSlashCatalog?.(catalogInfo.config, catalogInfo.getEntries);
  } else {
    dropdown.resetSdkSkillsCache();
  }

  dropdown.setHiddenCommands(getTabHiddenCommands(tab, plugin, conversation));
}

async function updateTabAgentSettings(
  tab: TabAgentContext,
  plugin: ObsiusPlugin,
  update: (settings: TabAgentSettings) => void,
): Promise<TabAgentSettings> {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  AgentSettingsCoordinator.commitAgentSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  await plugin.saveSettings();
  return snapshot;
}

function refreshTabAgentUI(tab: TabData, plugin: ObsiusPlugin): void {
  const capabilities = getTabCapabilities(tab);
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.modeSelector?.updateDisplay();
  tab.ui.modeSelector?.renderOptions();
  tab.ui.thinkingBudgetSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'obsius2-input-plan-mode',
    permissionMode === 'plan' && capabilities.supportsPlanMode,
  );
}

/**
 * Hides or disables UI elements that the active provider does not support.
 * Hides or disables toolbar controls the active runtime does not support.
 */
function applyCapabilityUIGating(tab: TabData): void {
  const capabilities = getTabCapabilities(tab);
  const uiConfig = AgentServices.getChatUIConfig();
  const hasPermissionToggle = Boolean(uiConfig.getPermissionModeToggle?.());

  if (!capabilities.supportsMcpTools) {
    tab.ui.mcpServerSelector?.clearEnabled();
    tab.ui.mcpServerSelector?.setMcpManager(null);
    tab.ui.fileContextManager?.setMcpManager(null);
  } else {
    const mcpManager = AgentWorkspace.getMcpServerManager();
    tab.ui.mcpServerSelector?.setMcpManager(mcpManager);
    tab.ui.fileContextManager?.setMcpManager(mcpManager);
  }
  tab.ui.mcpServerSelector?.setVisible(capabilities.supportsMcpTools);
  tab.ui.permissionToggle?.setVisible(hasPermissionToggle);
  tab.ui.fileContextManager?.setAgentService(null);

  tab.ui.imageContextManager?.setEnabled(capabilities.supportsImageAttachments);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

function syncTabAgentServices(
  tab: TabData,
  plugin: ObsiusPlugin,
): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = AgentServices.createInstructionRefineService(plugin);
  tab.services.subagentManager.setTaskResultInterpreter?.(
    AgentServices.getTaskResultInterpreter(),
  );
}

function ensureTitleGenerationService(tab: TabData, plugin: ObsiusPlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = AgentServices.createTitleGenerationService(plugin);
  }
}

function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === 'function') {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}

/** Refreshes blank-tab model options after settings or environment changes. */
export function refreshBlankTabModelState(tab: TabData, plugin: ObsiusPlugin): void {
  if (tab.lifecycleState !== 'blank') return;

  const settingsSnapshot = plugin.settings as unknown as Record<string, unknown>;

  if (tab.draftModel) {
    const uiConfig = AgentServices.getChatUIConfig();
    if (!uiConfig.ownsModel(tab.draftModel, settingsSnapshot)) {
      const fallbackModels = uiConfig.getModelOptions(settingsSnapshot);
      tab.draftModel = fallbackModels[0]?.value ?? tab.draftModel;
    }
  }

  syncTabAgentServices(tab, plugin);
  tab.ui.slashCommandDropdown?.setHiddenCommands(getTabHiddenCommands(tab, plugin));
  tab.ui.slashCommandDropdown?.resetSdkSkillsCache();
  refreshTabAgentUI(tab, plugin);
  applyCapabilityUIGating(tab);
}

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    plugin,
    containerEl,
    conversation,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({ cls: 'obsius2-tab-content obsius2-hidden' });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onAttentionChanged: onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
  });

  // Create subagent manager with no-op callback.
  // This placeholder is replaced in initializeTabControllers() with the actual
  // callback that updates the StreamController. We defer the real callback
  // because StreamController doesn't exist until controllers are initialized.
  const subagentManager = new SubagentManager(() => {});

  const dom = buildTabDOM(contentEl);
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!conversation?.id;
  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const draftModel = isBound
    ? null
    : (restoredDraftModel || resolveBlankTabModel(plugin));

  const tab: TabData = {
    id,
    lifecycleState: isBound ? 'bound_cold' : 'blank',
    draftModel,
    conversationId: conversation?.id ?? null,
    service: null,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager,
      instructionRefineService: null,
      titleGenerationService: null,
    },
    ui: {
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      contextUsageMeter: null,
      statusPanel: null,
      navigationSidebar: null,
    },
    dom,
    renderer: null,
  };

  return tab;
}

/**
 * Builds the DOM structure for a tab.
 */
function buildTabDOM(contentEl: HTMLElement): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({ cls: 'obsius2-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'obsius2-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'obsius2-welcome' });
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'obsius2-status-panel-container' });
  const inputContainerEl = contentEl.createDiv({ cls: 'obsius2-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'obsius2-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'obsius2-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'obsius2-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'obsius2-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'obsius2-input',
    attr: {
      placeholder: 'How can i help you today?',
      rows: '3',
      dir: 'auto',
    },
  });

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    inputEl,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}

function initializeContextManagers(tab: TabData, plugin: ObsiusPlugin): void {
  const { dom } = tab;
  const app = plugin.app;

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.inputEl,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl
  );
  tab.ui.fileContextManager.setMcpManager(AgentWorkspace.getMcpServerManager());

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl
  );
}

function initializeSlashCommands(
  tab: TabData,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: { config: SlashCommandDropdownConfig; getEntries: () => Promise<SlashCatalogEntry[]> } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onSelect: () => {},
      onHide: () => {},
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      catalogConfig: catalogInfo?.config,
      getCatalogEntries: catalogInfo?.getEntries,
    }
  );
}

/**
 * Initializes instruction mode and todo panel for a tab.
 */
function initializeInstructionAndTodo(tab: TabData, plugin: ObsiusPlugin): void {
  const { dom } = tab;

  syncTabAgentServices(tab, plugin);
  ensureTitleGenerationService(tab, plugin);
  tab.ui.instructionModeManager = new InstructionModeManagerClass(
    dom.inputEl,
    {
      onSubmit: async (rawInstruction) => {
        await tab.controllers.inputController?.handleInstructionSubmit(rawInstruction);
      },
      getInputWrapper: () => dom.inputWrapper,
    }
  );

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}

/**
 * Creates and wires the input toolbar for a tab.
 */
function initializeInputToolbar(
  tab: TabData,
  plugin: ObsiusPlugin,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom } = tab;

  const inputToolbar = dom.inputWrapper.createDiv({ cls: 'obsius2-input-toolbar' });

  // Blank-tab UI config wrapper that returns mixed model options
  const blankTabUIConfigProxy = (): ChatUIConfig => {
    const baseConfig = AgentServices.getChatUIConfig();
    return {
      ...baseConfig,
      getModelOptions: (settings: Record<string, unknown>) =>
        getBlankTabModelOptions(settings),
    };
  };

  const toolbarComponents = createInputToolbar(inputToolbar, {
    getUIConfig: () => {
      if (tab.lifecycleState === 'blank') {
        return blankTabUIConfigProxy();
      }
      return getTabChatUIConfig(tab, plugin);
    },
    getCapabilities: () => getTabCapabilities(tab),
    getSettings: () => getTabSettingsSnapshot(tab, plugin),
    getEnvironmentVariables: () => plugin.getActiveEnvironmentVariables(),
    onModelChange: async (model: string) => {
      if (tab.lifecycleState === 'blank') {
        tab.draftModel = model;
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig);

        const uiConfig = AgentServices.getChatUIConfig();
        await updateTabAgentSettings(tab, plugin, (settings) => {
          settings.model = tab.draftModel ?? model;
          uiConfig.applyModelDefaults(tab.draftModel ?? model, settings);
        });
        await uiConfig.prepareModelMetadata?.(tab.draftModel ?? model, plugin.settings, { plugin });
        tab.ui.thinkingBudgetSelector?.updateDisplay();
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.modeSelector?.updateDisplay();
        // Re-render options (provider may have changed reasoning controls)
        tab.ui.modelSelector?.renderOptions();
        tab.ui.modeSelector?.renderOptions();
        applyCapabilityUIGating(tab);
        return;
      }

      const uiConfig: ChatUIConfig = getTabChatUIConfig(tab, plugin);
      const providerSettings = await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.model = model;
        uiConfig.applyModelDefaults(model, settings);
      });
      await uiConfig.prepareModelMetadata?.(model, plugin.settings, { plugin });
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();

      // Recalculate context usage percentage for the new model's context window
      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = uiConfig.getContextWindowSize(
          model,
          providerSettings.customContextLimits,
        );
        tab.state.usage = recalculateUsageForModel(currentUsage, model, newContextWindow);
      }
    },
    onModeChange: async (mode: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        getTabChatUIConfig(tab, plugin).applyModeSelection?.(mode, settings);
      });
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
    },
    onThinkingBudgetChange: async (budget: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.thinkingBudget = budget;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, budget, settings);
      });
    },
    onEffortLevelChange: async (effort: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.effortLevel = effort;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, effort, settings);
      });
    },
    onPermissionModeChange: async (mode: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        const uiConfig = getTabChatUIConfig(tab, plugin);
        if (uiConfig.applyPermissionMode) {
          uiConfig.applyPermissionMode(mode, settings);
        } else {
          settings.permissionMode = mode;
        }
      });
      tab.ui.permissionToggle?.updateDisplay();
      dom.inputWrapper.toggleClass(
        'obsius2-input-plan-mode',
        mode === 'plan' && getTabCapabilities(tab).supportsPlanMode,
      );
    },
  });

  tab.ui.modelSelector = toolbarComponents.modelSelector;
  tab.ui.modeSelector = toolbarComponents.modeSelector;
  tab.ui.thinkingBudgetSelector = toolbarComponents.thinkingBudgetSelector;
  tab.ui.contextUsageMeter = toolbarComponents.contextUsageMeter;
  tab.ui.externalContextSelector = toolbarComponents.externalContextSelector;
  tab.ui.mcpServerSelector = toolbarComponents.mcpServerSelector;
  tab.ui.permissionToggle = toolbarComponents.permissionToggle;

  tab.ui.mcpServerSelector.setMcpManager(AgentWorkspace.getMcpServerManager());

  // Sync @-mentions to UI selector
  tab.ui.fileContextManager?.setOnMcpMentionChange((servers) => {
    tab.ui.mcpServerSelector?.addMentionedServers(servers);
  });

  // Wire external context changes
  tab.ui.externalContextSelector.setOnChange(() => {
    tab.ui.fileContextManager?.preScanExternalContexts();
  });

  // Initialize persistent paths
  tab.ui.externalContextSelector.setPersistentPaths(
    plugin.settings.persistentExternalContextPaths || []
  );

  // Wire persistence changes
  tab.ui.externalContextSelector.setOnPersistenceChange((paths) => {
    plugin.settings.persistentExternalContextPaths = paths;
    void plugin.saveSettings();
  });

  refreshTabAgentUI(tab, plugin);

  // Gate provider-specific UI elements
  applyCapabilityUIGating(tab);
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
  plugin: ObsiusPlugin,
  options: InitializeTabUIOptions = {}
): void {
  const { dom, state } = tab;

  // Initialize context managers (file/image)
  initializeContextManagers(tab, plugin);

  // Selection indicator - add to contextRowEl
  dom.selectionIndicatorEl = dom.contextRowEl.createDiv({ cls: 'obsius2-selection-indicator obsius2-hidden' });

  dom.browserIndicatorEl = dom.contextRowEl.createDiv({ cls: 'obsius2-browser-selection-indicator obsius2-hidden' });

  dom.canvasIndicatorEl = dom.contextRowEl.createDiv({ cls: 'obsius2-canvas-indicator obsius2-hidden' });

  const catalogInfo = options.getSlashCatalogConfig?.() ?? null;
  initializeSlashCommands(
    tab,
    () => getTabHiddenCommands(tab, plugin),
    catalogInfo,
  );

  if (dom.messagesEl.parentElement) {
    tab.ui.navigationSidebar = new NavigationSidebar(
      dom.messagesEl.parentElement,
      dom.messagesEl
    );
  }

  initializeInstructionAndTodo(tab, plugin);
  initializeInputToolbar(tab, plugin, options.getSlashCatalogConfig);

  state.callbacks = {
    ...state.callbacks,
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
    },
    onTodosChanged: (todos) => tab.ui.statusPanel?.updateTodos(todos),
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
  };

  // ResizeObserver to detect overflow changes (e.g., content growth)
  const resizeObserver = new ResizeObserver(() => {
    tab.ui.navigationSidebar?.updateVisibility();
  });
  resizeObserver.observe(dom.messagesEl);
  dom.eventCleanups.push(() => resizeObserver.disconnect());
}

export interface ForkContext {
  messages: ChatMessage[];
  sourceSessionId: string;
  sourceAgentState?: Record<string, unknown>;
  resumeAt: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  // Keep fork numbering stable by excluding non-semantic user messages.
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

interface ForkSource {
  sourceSessionId: string;
  sourceAgentState?: Record<string, unknown>;
  sourceTitle?: string;
  currentNote?: string;
}

/**
 * Resolves session ID and conversation metadata needed for forking.
 * Prefers the live service session ID; falls back to persisted conversation metadata.
 * Shows a notice and returns null when no session can be resolved.
 */
function resolveForkSource(tab: TabData, plugin: ObsiusPlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  // Delegate session ID resolution to the runtime when available;
  // fall back to persisted conversation metadata when no runtime is active.
  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : AgentServices
      .getConversationHistoryService()
      .resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    sourceSessionId,
    sourceAgentState: conversation?.agentState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

async function handleForkRequest(
  tab: TabData,
  plugin: ObsiusPlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab).supportsFork) {
    new Notice('Fork is not available in the current runtime.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    sourceSessionId: source.sourceSessionId,
    sourceAgentState: source.sourceAgentState,
    resumeAt: rewindCtx.prevAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
    currentNote: source.currentNote,
  });
}

async function handleForkAll(
  tab: TabData,
  plugin: ObsiusPlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab).supportsFork) {
    new Notice('Fork is not available in the current runtime.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    sourceSessionId: source.sourceSessionId,
    sourceAgentState: source.sourceAgentState,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

export function initializeTabControllers(
  tab: TabData,
  plugin: ObsiusPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom, state, services, ui } = tab;

  // Create renderer
  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesEl,
    (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
    () => getTabCapabilities(tab),
  );

  // Selection controller
  tab.controllers.selectionController = new SelectionController(
    plugin.app,
    dom.selectionIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl),
    dom.contentEl,
  );

  tab.controllers.browserSelectionController = new BrowserSelectionController(
    plugin.app,
    dom.browserIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.canvasSelectionController = new CanvasSelectionController(
    plugin.app,
    dom.canvasIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
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

  // Wire subagent callback now that StreamController exists
  // DOM updates for async subagents are handled by SubagentManager directly;
  // this callback handles message persistence.
  services.subagentManager.setCallback(
    (subagent) => {
      tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);

      // During active stream, regular end-of-turn save captures latest state.
      if (!tab.state.isStreaming && tab.state.currentConversationId) {
        void tab.controllers.conversationController?.save(false).catch(() => {
          // Best-effort persistence; avoid surfacing background-save failures here.
        });
      }
    }
  );

  tab.controllers.conversationController = new ConversationController(
    {
      plugin,
      state,
      renderer: tab.renderer,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null, // Tab doesn't have its own history dropdown
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      getFileContextManager: () => ui.fileContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => ui.statusPanel,
      getAgentService: () => tab.service, // Use tab's service instead of plugin's
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingApproval(),
      ensureServiceForConversation: async (conversation) => {
        tab.conversationId = conversation?.id ?? null;
        tab.draftModel = null;
        tab.lifecycleState = conversation ? 'bound_cold' : 'blank';
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig, conversation);

        if (tab.service && conversation) {
          const hasMessages = conversation.messages.length > 0;
          const externalContextPaths = hasMessages
            ? conversation.externalContextPaths || []
            : (plugin.settings.persistentExternalContextPaths || []);
          tab.service.syncConversationState(conversation, externalContextPaths);
        }

        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab);
      },
    },
    {
      onNewConversation: () => {
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin);
        tab.conversationId = null;
        syncTabAgentServices(tab, plugin);
        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab);
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig);
      },
      onConversationLoaded: () => ui.slashCommandDropdown?.resetSdkSkillsCache(),
      onConversationSwitched: () => ui.slashCommandDropdown?.resetSdkSkillsCache(),
    }
  );

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    renderer: tab.renderer,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    browserSelectionController: tab.controllers.browserSelectionController,
    canvasSelectionController: tab.controllers.canvasSelectionController,
    conversationController: tab.controllers.conversationController,
    getInputEl: () => dom.inputEl,
    getInputContainerEl: () => dom.inputContainerEl,
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getMcpServerSelector: () => ui.mcpServerSelector,
    getExternalContextSelector: () => ui.externalContextSelector,
    getInstructionModeManager: () => ui.instructionModeManager,
    getInstructionRefineService: () => services.instructionRefineService,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => ui.statusPanel,
    generateId: generateMessageId,
    resetInputHeight: () => {
      // Per-tab input height is managed by CSS, no dynamic adjustment needed
    },
    getAuxiliaryModel: () => tab.service?.getAuxiliaryModel?.() ?? tab.draftModel ?? null,
    getAgentService: () => tab.service,
    getSubagentManager: () => services.subagentManager,
    ensureServiceInitialized: async () => {
      if (tab.serviceInitialized && tab.lifecycleState === 'bound_active') {
        return true;
      }

      try {
        await initializeTabService(tab, plugin);
        setupServiceCallbacks(tab, plugin);

        // Transition: lock model selector to bound provider
        refreshTabAgentUI(tab, plugin);
        applyCapabilityUIGating(tab);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Failed to initialize chat service');
        return false;
      }
    },
    openConversation,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, plugin, forkRequestCallback)
      : undefined,
    restorePrePlanPermissionModeIfNeeded: () => {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
        tab.state.prePlanPermissionMode = null;
        updatePlanModeUI(tab, plugin, restoreMode);
      }
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.inputEl,
    getSettings: () => plugin.settings.keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.instructionModeManager?.isActive()) return true;
      if (tab.controllers.inputController?.isResumeDropdownVisible()) return true;
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 * Stores cleanup functions in dom.eventCleanups for proper memory management.
 */
export function wireTabInputEvents(tab: TabData, plugin: ObsiusPlugin): void {
  const { dom, ui, state, controllers } = tab;

  const keydownHandler = (e: KeyboardEvent) => {
    if (getTabCapabilities(tab).supportsInstructionMode && ui.instructionModeManager?.handleTriggerKey(e)) {
      return;
    }

    if (getTabCapabilities(tab).supportsInstructionMode && ui.instructionModeManager?.handleKeydown(e)) {
      return;
    }

    if (controllers.inputController?.handleResumeKeydown(e)) {
      return;
    }

    if (ui.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (ui.fileContextManager?.handleMentionKeydown(e)) {
      return;
    }

    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if (e.key === 'Escape' && !e.isComposing && state.isStreaming) {
      e.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }

    if (shouldSendMessageFromEnterKey(e, plugin.settings)) {
      e.preventDefault();
      void controllers.inputController?.sendMessage();
    }
  };
  dom.inputEl.addEventListener('keydown', keydownHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('keydown', keydownHandler));

  const inputHandler = () => {
    ui.fileContextManager?.handleInputChange();
    ui.instructionModeManager?.handleInputChange();
    autoResizeTextarea(dom.inputEl);
  };
  dom.inputEl.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', inputHandler));

  // Sidebar focus handler — show selection highlight when focus enters the tab from outside
  const focusHandler = (e: FocusEvent) => {
    if (e.relatedTarget && dom.contentEl.contains(e.relatedTarget as Node)) return;
    controllers.selectionController?.showHighlight();
  };
  dom.contentEl.addEventListener('focusin', focusHandler);
  dom.eventCleanups.push(() => dom.contentEl.removeEventListener('focusin', focusHandler));

  // Scroll listener for auto-scroll control (tracks position always, not just during streaming)
  const SCROLL_THRESHOLD = 20; // pixels from bottom to consider "at bottom"
  const RE_ENABLE_DELAY = 150; // ms to wait before re-enabling auto-scroll
  let reEnableTimeout: number | null = null;

  const isAutoScrollAllowed = (): boolean => plugin.settings.enableAutoScroll ?? true;

  const scrollHandler = () => {
    if (!isAutoScrollAllowed()) {
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;

    if (!isAtBottom) {
      // Immediately disable when user scrolls up
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled) {
      // Debounce re-enabling to avoid bounce during scroll animation
      if (!reEnableTimeout) {
        reEnableTimeout = window.setTimeout(() => {
          reEnableTimeout = null;
          // Re-verify position before enabling (content may have changed)
          const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
          if (scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD) {
            state.autoScrollEnabled = true;
          }
        }, RE_ENABLE_DELAY);
      }
    }
  };
  dom.messagesEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.messagesEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) window.clearTimeout(reEnableTimeout);
  });
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass('obsius2-hidden');
  tab.controllers.selectionController?.start();
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  // Refresh navigation sidebar visibility (dimensions now available after display)
  tab.ui.navigationSidebar?.updateVisibility();
}

/**
 * Deactivates a tab (hides it and stops services).
 */
export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.addClass('obsius2-hidden');
  tab.controllers.selectionController?.stop();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 * Made async to ensure proper cleanup ordering.
 */
export async function destroyTab(tab: TabData): Promise<void> {
  tab.lifecycleState = 'closing';

  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.browserSelectionController?.clear();
  tab.controllers.canvasSelectionController?.stop();
  tab.controllers.canvasSelectionController?.clear();
  tab.controllers.navigationController?.dispose();

  cleanupThinkingBlock(tab.state.currentThinkingState);
  tab.state.currentThinkingState = null;

  // Dismiss pending inline prompts before DOM teardown
  tab.controllers.inputController?.dismissPendingApproval();

  tab.controllers.inputController?.destroyResumeDropdown();
  tab.ui.fileContextManager?.destroy();
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;
  tab.ui.instructionModeManager?.destroy();
  tab.ui.instructionModeManager = null;
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = null;
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

  // Clean up runtime before removing DOM
  tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
}

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: ObsiusPlugin): string {
  if (tab.conversationId) {
    const conversation = plugin.getConversationSync(tab.conversationId);
    if (conversation?.title) {
      return conversation.title;
    }
  }
  return 'New Chat';
}

/** Shared between Tab.ts and TabManager.ts to avoid duplication. */
export function setupServiceCallbacks(tab: TabData, plugin: ObsiusPlugin): void {
  if (tab.service && tab.controllers.inputController) {
    tab.service.setApprovalCallback(
      async (toolName, input, description, options) =>
        await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
        ?? 'cancel'
    );
    tab.service.setApprovalDismisser(
      () => tab.controllers.inputController?.dismissPendingApprovalPrompt()
    );
    tab.service.setAskUserQuestionCallback(
      async (input, signal) =>
        await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
        ?? null
    );
    tab.service.setExitPlanModeCallback(
      async (input, signal) => {
        const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
        // Revert only on approve; feedback and cancel keep plan mode active.
        if (decision !== null && decision.type !== 'feedback') {
          // Only restore permission mode if still in plan mode — user may have toggled out via Shift+Tab
          if (getTabPermissionMode(tab, plugin) === 'plan') {
            const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
            tab.state.prePlanPermissionMode = null;
            updatePlanModeUI(tab, plugin, restoreMode);
          }
          if (decision.type === 'approve-new-session') {
            tab.state.pendingNewSessionPlan = decision.planContent;
            tab.state.cancelRequested = true;
          }
        }
        return decision;
      }
    );
    tab.service.setSubagentHookState(
      () => ({
        hasRunning: tab.services.subagentManager.hasRunningSubagents(),
      })
    );
    tab.service.setAutoTurnCallback((result: AutoTurnResult) => renderAutoTriggeredTurn(tab, result));
    tab.service.setPermissionModeSyncCallback((runtimeMode) => {
      const mode = runtimeMode === 'plan' ? 'plan' : 'normal';
      const currentMode = getTabPermissionMode(tab, plugin);

      if (currentMode !== mode) {
        // Save pre-plan mode when entering plan (for Shift+Tab toggle restore)
        if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
          tab.state.prePlanPermissionMode = currentMode;
        }
        updatePlanModeUI(tab, plugin, mode);
      }
    });
  }
}

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Renders an auto-triggered turn (e.g., agent response to task-notification)
 * that arrives after the main handler has completed.
 */
function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

async function renderAutoTriggeredTurn(tab: TabData, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) {
    return;
  }

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.obsius2-message-content');
    if (contentEl) {
      if (!previousContentEl) {
        tab.state.toolCallElements.clear();
      }
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}

export function updatePlanModeUI(tab: TabData, plugin: ObsiusPlugin, mode: string): void {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  const uiConfig = AgentServices.getChatUIConfig();
  if (uiConfig.applyPermissionMode) {
    uiConfig.applyPermissionMode(mode, snapshot);
  } else {
    snapshot.permissionMode = mode;
  }
  AgentSettingsCoordinator.commitAgentSettingsSnapshot(
    plugin.settings,
    snapshot,
  );
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'obsius2-input-plan-mode',
    mode === 'plan' && getTabCapabilities(tab).supportsPlanMode,
  );
}
