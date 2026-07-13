import { recalculateUsageForModel } from "@pivi/pivi-agent-core/foundation/usage";
import type { ChatPorts } from "@pivi/pivi-agent-core/runtime/chatPorts";
import { Notice } from "obsidian";

import type { PiviChatHost } from "@/app/hostContracts";
import { t } from "@/app/i18n";

import { pickDirectoryPath } from '../../shared/utils/folderPicker';
import { ExternalContextSelector } from "../toolbar/ExternalContextControl";
import type { ToolbarCallbacks } from "../toolbar/ToolbarTypes";
import { InlineContextManager } from "../ui/InlineContext";
import { autoResizeTextarea } from "../ui/textareaResize";
import {
  applyCapabilityUIGating,
  cleanupTabRuntime,
  updateTabAgentSettings,
} from "./tabAgentContext";
import {
  type SlashCatalogInfo,
  syncSlashCommandDropdown,
} from "./tabSlashCatalog";
import type { TabData } from "./types";

/**
 * Wires composer chrome snapshots and React actions for a tab.
 */
export function wireComposerChrome(
  tab: TabData,
  plugin: PiviChatHost,
  ports: ChatPorts,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom } = tab;

  const refreshUsageContextWindow = (
    model: string,
    customContextLimits: Record<string, number>,
  ): void => {
    if (ports.settings.getSettingsSnapshot().model !== model) return;
    const currentUsage = tab.state.usage;
    if (!currentUsage) return;
    tab.state.usage = recalculateUsageForModel(
      currentUsage,
      model,
      ports.models.getContextWindowSize(model, customContextLimits),
    );
  };

  tab.ui.inlineContextManager = new InlineContextManager(dom.richInput, {
    onContextsChanged: () => {
      tab.controllers.selectionController?.updateContextRowVisibility();
      tab.controllers.browserSelectionController?.updateContextRowVisibility();
      tab.controllers.canvasSelectionController?.updateContextRowVisibility();
      autoResizeTextarea(dom.richInput.el);
      tab.renderer?.scrollToBottomIfNeeded();
    },
  });

  const toolbarCallbacks: ToolbarCallbacks = {
    getUIConfig: () => ports.models,
    getSettings: () => ports.settings.getSettingsSnapshot(),
    getModelReadinessProvider: () => ports.models.getReadinessProvider(),
    onModelChange: async (model: string) => {
      if (tab.lifecycleState === "blank") {
        tab.draftModel = model;
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        syncSlashCommandDropdown(tab, ports.settings, getSlashCatalogConfig);

        const uiConfig = ports.models;
        const providerSettings = await updateTabAgentSettings(ports, (settings) => {
          settings.model = tab.draftModel ?? model;
          uiConfig.applyModelDefaults(tab.draftModel ?? model, settings);
        });
        refreshUsageContextWindow(model, providerSettings.customContextLimits);
        await uiConfig.prepareModelMetadata(
          tab.draftModel ?? model,
        );
        refreshUsageContextWindow(model, providerSettings.customContextLimits);
        applyCapabilityUIGating(tab, ports);
        tab.service?.syncThinkingLevel?.();
        return;
      }

      const uiConfig = ports.models;
      const providerSettings = await updateTabAgentSettings(
        ports,
        (settings) => {
          settings.model = model;
          uiConfig.applyModelDefaults(model, settings);
        },
      );
      refreshUsageContextWindow(model, providerSettings.customContextLimits);
      await uiConfig.prepareModelMetadata(model);
      refreshUsageContextWindow(model, providerSettings.customContextLimits);
      tab.service?.syncThinkingLevel?.();
    },
    onModeChange: async (mode: string) => {
      await updateTabAgentSettings(ports, (settings) => {
        ports.models.applyModeSelection?.(mode, settings);
      });
    },
    onThinkingBudgetChange: async (budget: string) => {
      await updateTabAgentSettings(ports, (settings) => {
        settings.thinkingBudget = budget;
        ports.models.applyReasoningSelection?.(
          settings.model,
          budget,
          settings,
        );
      });
    },
    onThinkingLevelChange: async (thinkingLevel: string) => {
      await updateTabAgentSettings(ports, (settings) => {
        settings.thinkingLevel = thinkingLevel;
        ports.models.applyReasoningSelection?.(
          settings.model,
          thinkingLevel,
          settings,
        );
      });
      tab.service?.syncThinkingLevel?.();
    },
  };
  tab.ui.externalContextSelector = new ExternalContextSelector();
  tab.ui.externalContextSelector.setOnChange(externalContext => tab.state.uiStore.update({ externalContext }));
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
        modelOptions: uiConfig.getModelOptions(settings).map(option => ({ ...option })),
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

  tab.ui.externalContextSelector.setOnPinnedChange(async (pinnedPaths) => {
    await ports.settings.setPinnedExternalReadDirectories(pinnedPaths);
  });

  const defaultExternalPaths = ports.settings
    .getSettingsSnapshot().externalReadDirectories;
  tab.ui.externalContextSelector.resetForSession(defaultExternalPaths);

  tab.ui.composerActions?.refresh();
  applyCapabilityUIGating(tab, ports);
}
