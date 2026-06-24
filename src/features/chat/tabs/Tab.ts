import { type App, MarkdownView, Notice } from 'obsidian';

import { AgentServices } from '../../../core/agent/AgentServices';
import { AgentWorkspace } from '../../../core/agent/AgentWorkspace';
import type { SlashCommandDropdownConfig } from '../../../core/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../../core/agent/commands/SlashCommandEntry';
import type { ChatUIConfig, ChatUIOption } from '../../../core/agent/types';
import type { OpenSessionState } from '../../../core/types';
import type ObsiusPlugin from '../../../main';
import { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import { getActiveWindow } from '../../../shared/dom';
import { CreateCommandModal } from '../../../shared/modals/CreateCommandModal';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { FileContextManager } from '../ui/FileContext';
import { ImageContextManager } from '../ui/ImageContext';
import { InlineContextManager } from '../ui/InlineContext';
import { InputSendButton } from '../ui/InputSendButton';
import { createInputToolbar } from '../ui/InputToolbar';
import { NavigationSidebar } from '../ui/NavigationSidebar';
import { RichChatInput } from '../ui/RichChatInput';
import { StatusPanel } from '../ui/StatusPanel';
import { autoResizeTextarea } from '../ui/textareaResize';
import { recalculateUsageForModel } from '../utils/usageInfo';
import {
  applyCapabilityUIGating,
  cleanupTabRuntime,
  ensureTitleGenerationService,
  getTabCapabilities,
  getTabChatUIConfig,
  getTabHiddenCommands,
  getTabSettingsSnapshot,
  refreshTabAgentUI,
  resolveBlankTabModel,
  shouldSendMessageFromEnterKey,
  syncTabAgentServices,
  updateTabAgentSettings,
} from './tabAgentContext';
import { type SlashCatalogInfo,syncSlashCommandDropdown } from './tabSlashCatalog';
import type { TabData, TabDOMElements, TabId } from './types';
import { generateTabId } from './types';

export { initializeTabControllers } from './tabControllerInit';
export type { ForkContext } from './tabFork';
export { updatePlanModeUI } from './tabPlanMode';
export { initializeTabService } from './tabRuntime';

/**
 * Returns model options for a blank tab.
 * Uses provider registration metadata to determine which providers are
 * available and how they should appear in the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ChatUIOption[] {
  const uiConfig = AgentServices.getChatUIConfig();
  return uiConfig.getModelOptions(settings);
}

export interface TabCreateOptions {
  plugin: ObsiusPlugin;

  containerEl: HTMLElement;
  openSession?: OpenSessionState;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onOpenSessionIdChanged?: (openSessionId: string | null) => void;
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
  tab.ui.slashCommandDropdown?.resetRuntimeSkillsCache();
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
    openSession,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onOpenSessionIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({ cls: 'obsius2-tab-content obsius2-hidden' });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onAttentionChanged: onAttentionChanged,
    onOpenSessionChanged: onOpenSessionIdChanged,
  });

  // Create subagent manager with no-op callback.
  // This placeholder is replaced in initializeTabControllers() with the actual
  // callback that updates the StreamController. We defer the real callback
  // because StreamController doesn't exist until controllers are initialized.
  const subagentManager = new SubagentManager(() => {});

  const dom = buildTabDOM(contentEl, plugin.app);
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!openSession?.id;
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
    openSessionId: openSession?.id ?? null,
    sessionFile: openSession?.sessionFile ?? null,
    leafId: openSession?.leafId ?? null,
    service: null,
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

  return tab;
}

/**
 * Builds the DOM structure for a tab.
 */
function buildTabDOM(contentEl: HTMLElement, app: App): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({ cls: 'obsius2-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'obsius2-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'obsius2-welcome' });
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'obsius2-status-panel-container' });
  const inputContainerEl = contentEl.createDiv({ cls: 'obsius2-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'obsius2-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'obsius2-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'obsius2-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'obsius2-context-row' });
  const richInput = new RichChatInput(inputWrapper, {
    placeholder: 'How can i help you today?',
    getMentionContext: () => ({
      app,
      mcpServerNames: new Set(),
    }),
  });
  richInput.el.setAttr('dir', 'auto');

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    richInput,
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
    dom.richInput,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl
  );
  tab.ui.fileContextManager.setMcpManager(AgentWorkspace.getMcpServerManager());
  dom.richInput.setMentionContextGetter(() => tab.ui.fileContextManager!.buildMentionBadgeContext());

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.richInput,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl
  );
}

function initializeSlashCommands(
  tab: TabData,
  plugin: ObsiusPlugin,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: { config: SlashCommandDropdownConfig; getEntries: () => Promise<SlashCatalogEntry[]> } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.richInput,
    {
      onSelect: (command) => {
        if (command.id === 'create-command') {
          new CreateCommandModal(plugin.app, plugin).open();
          dom.richInput.value = '';
          dom.richInput.el.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        if (command.source === 'user') {
          void (async () => {
            try {
              const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
              const editor = activeView?.editor;
              const file = activeView?.file;

              const selectedText = editor?.getSelection() ?? '';
              if (!selectedText && command.content.includes('{{selected_text}}')) {
                new Notice('No text selected in the active editor.');
              }

              let fileContent = '';
              if (file) {
                fileContent = await plugin.app.vault.read(file);
              }

              const fileName = file?.basename ?? '';
              const dateStr = new Date().toLocaleDateString();

              const resolvedContent = command.content
                .replace(/{{selected_text}}/g, selectedText)
                .replace(/{{current_note}}/g, fileContent)
                .replace(/{{current_file}}/g, fileContent)
                .replace(/{{current_note_name}}/g, fileName)
                .replace(/{{current_file_name}}/g, fileName)
                .replace(/{{date}}/g, dateStr);

              const text = dom.richInput.value;
              const prefix = `/${command.name} `;
              if (text.startsWith(prefix)) {
                dom.richInput.value = resolvedContent + text.substring(prefix.length);
                dom.richInput.selectionStart = resolvedContent.length;
              } else {
                const index = text.indexOf(prefix);
                if (index !== -1) {
                  dom.richInput.value = text.substring(0, index) + resolvedContent + text.substring(index + prefix.length);
                  dom.richInput.selectionStart = index + resolvedContent.length;
                } else {
                  dom.richInput.value = resolvedContent;
                  dom.richInput.selectionStart = resolvedContent.length;
                }
              }

              dom.richInput.focus();
              dom.richInput.el.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (error) {
              console.error('Obsius: Failed to resolve custom template command:', error);
              new Notice('Failed to resolve template command variables.');
            }
          })();
        }
      },
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

  tab.ui.inlineContextManager = new InlineContextManager(
    dom.richInput,
    {
      onContextsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
  );

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
    getModelReadinessProvider: () => AgentWorkspace.getModelReadinessProvider(),
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
        tab.service?.syncThinkingLevel?.();
        return;
      }

      const uiConfig: ChatUIConfig = getTabChatUIConfig(tab, plugin);
      const providerSettings = await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.model = model;
        uiConfig.applyModelDefaults(model, settings);
      });
      await uiConfig.prepareModelMetadata?.(model, plugin.settings, { plugin });
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.service?.syncThinkingLevel?.();
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
    onThinkingLevelChange: async (thinkingLevel: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.thinkingLevel = thinkingLevel;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(
          settings.model,
          thinkingLevel,
          settings,
        );
      });
      tab.service?.syncThinkingLevel?.();
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

  tab.ui.sendButton = new InputSendButton(inputToolbar, {
    getInputEl: () => dom.richInput,
    getIsStreaming: () => tab.state.isStreaming,
    onSend: () => {
      void tab.controllers.inputController?.sendMessage();
    },
    onStop: () => {
      tab.controllers.inputController?.cancelStreaming();
    },
  });

  tab.ui.mcpServerSelector.setMcpManager(AgentWorkspace.getMcpServerManager());
  tab.ui.mcpServerSelector.setRecoveryActions({
    mcpOAuth: AgentWorkspace.getMcpOAuth(),
    mcpProbeProvider: AgentWorkspace.getMcpServerProbeProvider(),
    openSettings: () => {
      const setting = (plugin.app as unknown as {
        setting?: { open: () => void; openTabById?: (id: string) => void };
      }).setting;
      if (!setting) {
        new Notice('Open Obsius settings to manage MCP servers.');
        return;
      }
      setting.open();
      setting.openTabById?.('community-plugins');
    },
  });

  // Sync slash MCP references to UI selector
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
    plugin,
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

  const priorStreamingChanged = state.callbacks.onStreamingStateChanged;
  state.callbacks = {
    ...state.callbacks,
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
    },
    onTodosChanged: (todos) => tab.ui.statusPanel?.updateTodos(todos),
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
    onStreamingStateChanged: (isStreaming) => {
      tab.ui.sendButton?.update();
      priorStreamingChanged?.(isStreaming);
    },
  };

  // ResizeObserver to detect overflow changes (e.g., content growth)
  const resizeObserver = new ResizeObserver(() => {
    tab.ui.navigationSidebar?.updateVisibility();
  });
  resizeObserver.observe(dom.messagesEl);
  dom.eventCleanups.push(() => resizeObserver.disconnect());
}

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 * Stores cleanup functions in dom.eventCleanups for proper memory management.
 */
export function wireTabInputEvents(tab: TabData, plugin: ObsiusPlugin): void {
  const { dom, ui, state, controllers } = tab;

  const keydownHandler = (e: KeyboardEvent) => {
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
  const pasteHandler = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          return;
        }
      }
    }
    dom.richInput.handlePaste(e);
  };
  dom.richInput.el.addEventListener('paste', pasteHandler);
  dom.eventCleanups.push(() => dom.richInput.el.removeEventListener('paste', pasteHandler));

  dom.richInput.addEventListener('keydown', keydownHandler as EventListener);
  dom.eventCleanups.push(() => dom.richInput.removeEventListener('keydown', keydownHandler as EventListener));

  const inputHandler = () => {
    ui.fileContextManager?.handleInputChange();

    ui.sendButton?.update();
    autoResizeTextarea(dom.richInput.el);
  };
  dom.richInput.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.richInput.removeEventListener('input', inputHandler));

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
        getActiveWindow(dom.messagesEl).clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
    const scrollWin = getActiveWindow(dom.messagesEl);

    if (!isAtBottom) {
      // Immediately disable when user scrolls up
      if (reEnableTimeout) {
        scrollWin.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled) {
      // Debounce re-enabling to avoid bounce during scroll animation
      if (!reEnableTimeout) {
        reEnableTimeout = scrollWin.setTimeout(() => {
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
    if (reEnableTimeout) getActiveWindow(dom.messagesEl).clearTimeout(reEnableTimeout);
  });
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass('obsius2-hidden');
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
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 */
export function destroyTab(tab: TabData): Promise<void> {
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

  // Clean up runtime before removing DOM
  tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
  return Promise.resolve();
}

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: ObsiusPlugin): string {
  if (tab.openSessionId) {
    const openSession = plugin.getOpenSessionSync(tab.openSessionId);
    if (openSession?.title) {
      return openSession.title;
    }
  }
  return 'New Chat';
}
