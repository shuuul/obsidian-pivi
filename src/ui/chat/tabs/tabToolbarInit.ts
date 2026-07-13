import { recalculateUsageForModel } from "@pivi/obsidian-ui";
import type { ChatUIConfig } from "@pivi/pivi-agent-core/foundation/chatUi";
import { getObsidianToolsSettingsFromBag } from "@pivi/pivi-agent-core/foundation/settings";
import { getRuntimeEnvironmentText } from "@pivi/pivi-agent-core/foundation/settingsAgentEnvironment";
import { Notice } from "obsidian";

import type { PiviChatHost } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { getDefaultExternalContextPaths } from "@/ui/shared/utils/defaultExternalContextPaths";

import { pickDirectoryPath } from '../../shared/utils/folderPicker';
import { ExternalContextSelector } from "../toolbar/ExternalContextControl";
import { McpServerSelector } from "../toolbar/McpControl";
import type { ToolbarCallbacks } from "../toolbar/ToolbarTypes";
import { InlineContextManager } from "../ui/InlineContext";
import { autoResizeTextarea } from "../ui/textareaResize";
import {
  applyCapabilityUIGating,
  cleanupTabRuntime,
  getTabChatUIConfig,
  getTabSettingsSnapshot,
  refreshTabAgentUI,
  updateTabAgentSettings,
} from "./tabAgentContext";
import {
  type SlashCatalogInfo,
  syncSlashCommandDropdown,
} from "./tabSlashCatalog";
import type { TabData } from "./types";

/**
 * Creates and wires the input toolbar for a tab.
 */
export function initializeInputToolbar(
  tab: TabData,
  plugin: PiviChatHost,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom } = tab;


  tab.ui.inlineContextManager = new InlineContextManager(dom.richInput, {
    onContextsChanged: () => {
      tab.controllers.selectionController?.updateContextRowVisibility();
      tab.controllers.browserSelectionController?.updateContextRowVisibility();
      tab.controllers.canvasSelectionController?.updateContextRowVisibility();
      autoResizeTextarea(dom.richInput.el);
      tab.renderer?.scrollToBottomIfNeeded();
    },
  });

  const blankTabUIConfigProxy = (): ChatUIConfig => {
    const baseConfig = plugin.getUiFacades().chatUIConfig;
    return {
      ...baseConfig,
      getModelOptions: (settings: Record<string, unknown>) =>
        baseConfig.getModelOptions(settings),
    };
  };

  const toolbarCallbacks: ToolbarCallbacks = {
    getUIConfig: () => {
      if (tab.lifecycleState === "blank") {
        return blankTabUIConfigProxy();
      }
      return getTabChatUIConfig(tab, plugin);
    },
    getSettings: () => getTabSettingsSnapshot(tab, plugin),
    getEnvironmentVariables: () => getRuntimeEnvironmentText(plugin.settings),
    getModelReadinessProvider: () =>
      plugin.getPiWorkspace()?.modelReadinessProvider ?? null,
    onModelChange: async (model: string) => {
      if (tab.lifecycleState === "blank") {
        tab.draftModel = model;
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig);

        const uiConfig = plugin.getUiFacades().chatUIConfig;
        await updateTabAgentSettings(tab, plugin, (settings) => {
          settings.model = tab.draftModel ?? model;
          uiConfig.applyModelDefaults(tab.draftModel ?? model, settings);
        });
        await uiConfig.prepareModelMetadata?.(
          tab.draftModel ?? model,
          plugin.settings,
          { host: plugin.getAgentHostContext() },
        );
        applyCapabilityUIGating(tab, plugin);
        tab.service?.syncThinkingLevel?.();
        return;
      }

      const uiConfig: ChatUIConfig = getTabChatUIConfig(tab, plugin);
      const providerSettings = await updateTabAgentSettings(
        tab,
        plugin,
        (settings) => {
          settings.model = model;
          uiConfig.applyModelDefaults(model, settings);
        },
      );
      await uiConfig.prepareModelMetadata?.(model, plugin.settings, {
        host: plugin.getAgentHostContext(),
      });
      tab.service?.syncThinkingLevel?.();

      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = uiConfig.getContextWindowSize(
          model,
          providerSettings.customContextLimits,
        );
        tab.state.usage = recalculateUsageForModel(
          currentUsage,
          model,
          newContextWindow,
        );
      }
    },
    onModeChange: async (mode: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        getTabChatUIConfig(tab, plugin).applyModeSelection?.(mode, settings);
      });
    },
    onThinkingBudgetChange: async (budget: string) => {
      await updateTabAgentSettings(tab, plugin, (settings) => {
        settings.thinkingBudget = budget;
        getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(
          settings.model,
          budget,
          settings,
        );
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
  };
  tab.ui.externalContextSelector = new ExternalContextSelector();
  tab.ui.mcpServerSelector = new McpServerSelector();
  tab.ui.externalContextSelector.setOnChange(externalContext => tab.state.uiStore.update({ externalContext }));
  // MCP selection is settings-owned; keep a hidden snapshot for legacy session fields only.
  tab.ui.mcpServerSelector.setVisible(false);
  tab.ui.mcpServerSelector.setOnSnapshotChange(mcp => tab.state.uiStore.update({ mcp: { ...mcp, visible: false } }));
  tab.ui.composerActions = {
    send: () => void tab.controllers.inputController?.sendMessage().finally(refreshComposerSnapshot),
    stop: () => tab.controllers.inputController?.cancelStreaming(),
    setModel: model => void toolbarCallbacks.onModelChange(model).then(refreshComposerSnapshot),
    setMode: mode => void toolbarCallbacks.onModeChange(mode).then(refreshComposerSnapshot),
    setThinkingBudget: budget => void toolbarCallbacks.onThinkingBudgetChange(budget).then(refreshComposerSnapshot),
    setThinkingLevel: level => void toolbarCallbacks.onThinkingLevelChange(level).then(refreshComposerSnapshot),
    toggleExternalPath: pathValue => tab.ui.externalContextSelector?.togglePath(pathValue),
    toggleExternalPinned: pathValue => tab.ui.externalContextSelector?.togglePinned(pathValue),
    removeExternalPath: pathValue => tab.ui.externalContextSelector?.removePath(pathValue),
    addExternalContext: () => void openExternalFolderPicker(),
    refresh: refreshComposerSnapshot,
  };

  async function openExternalFolderPicker(): Promise<void> {
    try {
      const selectedPath = await pickDirectoryPath({
        title: t('chat.toolbar.externalPickerTitle'),
        hostWindow: dom.inputWrapper.ownerDocument.defaultView,
      });
      if (!selectedPath) return;
      const result = tab.ui.externalContextSelector?.addExternalContext(selectedPath);
      if (result && !result.success) new Notice(result.error, 5000);
    } catch {
      new Notice(t('chat.toolbar.externalPickerFailed'), 5000);
    }
  }

  function refreshComposerSnapshot(): void {
    const settings = toolbarCallbacks.getSettings();
    const uiConfig = toolbarCallbacks.getUIConfig();
    const mode = uiConfig.getModeSelector?.(settings) ?? null;
    const reasoningOptions = uiConfig.getReasoningOptions(settings.model, settings);
    tab.state.uiStore.update({
      composer: {
        canSend: dom.richInput.value.trim().length > 0,
        model: settings.model,
        modelOptions: uiConfig.getModelOptions({
          ...settings,
          environmentVariables: toolbarCallbacks.getEnvironmentVariables?.(),
        }).map(option => ({ ...option })),
        mode: mode?.value ?? null,
        modeLabel: mode?.label ?? null,
        modeOptions: (mode?.options ?? []).map(option => ({ ...option })),
        modeActiveValue: mode?.activeValue ?? null,
        adaptiveReasoning: uiConfig.isAdaptiveReasoningModel(settings.model, settings),
        thinkingBudget: settings.thinkingBudget,
        thinkingLevel: settings.thinkingLevel,
        thinkingOptions: reasoningOptions.map(option => ({ ...option })),
        defaultReasoningValue: uiConfig.getDefaultReasoningValue(settings.model, settings),
      },
    });
  }
  refreshComposerSnapshot();

  tab.ui.mcpServerSelector.setMcpManager(
    plugin.getPiWorkspace()?.mcpServerManager ?? null,
  );

  tab.ui.externalContextSelector.setOnPinnedChange(async (pinnedPaths) => {
    const current = getObsidianToolsSettingsFromBag(plugin.settings);
    plugin.settings.agentSettings.obsidianTools = {
      ...current,
      externalReadDirectories: pinnedPaths,
    };
    await plugin.saveSettings();
    for (const view of plugin.getAllViews()) {
      view.getTabManager()?.syncPinnedExternalContextPaths(pinnedPaths);
    }
  });

  const defaultExternalPaths = getDefaultExternalContextPaths(plugin.settings);
  tab.ui.externalContextSelector.resetForSession(defaultExternalPaths);

  refreshTabAgentUI(tab, plugin);
  applyCapabilityUIGating(tab, plugin);
}
