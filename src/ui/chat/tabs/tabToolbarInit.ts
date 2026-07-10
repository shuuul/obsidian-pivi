import type { ChatUIConfig } from "@pivi/pivi-agent-core/foundation/chatUi";
import { getObsidianToolsSettingsFromBag } from "@pivi/pivi-agent-core/foundation/settings";
import { getRuntimeEnvironmentText } from "@pivi/pivi-agent-core/foundation/settingsAgentEnvironment";
import { Notice } from "obsidian";

import type { PiviChatHost } from "@/app/hostContracts";
import { t } from "@/i18n";
import { getDefaultExternalContextPaths } from "@/ui/shared/utils/defaultExternalContextPaths";

import { createInputToolbar } from "../toolbar/InputToolbar";
import { InlineContextManager } from "../ui/InlineContext";
import { InputSendButton } from "../ui/InputSendButton";
import { autoResizeTextarea } from "../ui/textareaResize";
import { recalculateUsageForModel } from "../utils/usageInfo";
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

interface CommunityPluginSettingsPane {
  open: () => void;
  openTabById?: (id: string) => void;
}

function isCommunityPluginSettingsPane(
  value: unknown,
): value is CommunityPluginSettingsPane {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<
    Record<keyof CommunityPluginSettingsPane, unknown>
  >;
  return (
    typeof candidate.open === "function" &&
    (candidate.openTabById === undefined ||
      typeof candidate.openTabById === "function")
  );
}

function openCommunityPluginSettings(plugin: PiviChatHost): void {
  const app = plugin.app;
  if (!app || typeof app !== "object" || !("setting" in app)) {
    new Notice(t("chat.errors.openMcpSettings"));
    return;
  }
  const setting = app.setting;
  if (!isCommunityPluginSettingsPane(setting)) {
    new Notice(t("chat.errors.openMcpSettings"));
    return;
  }
  setting.open();
  setting.openTabById?.("community-plugins");
}

/**
 * Creates and wires the input toolbar for a tab.
 */
export function initializeInputToolbar(
  tab: TabData,
  plugin: PiviChatHost,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
): void {
  const { dom } = tab;

  const inputToolbar = dom.inputWrapper.createDiv({
    cls: "pivi-input-toolbar",
  });

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

  const toolbarComponents = createInputToolbar(inputToolbar, {
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
        tab.ui.thinkingBudgetSelector?.updateDisplay();
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.modeSelector?.updateDisplay();
        tab.ui.modelSelector?.renderOptions();
        tab.ui.modeSelector?.renderOptions();
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
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.service?.syncThinkingLevel?.();
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();

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
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
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
  });

  tab.ui.modelSelector = toolbarComponents.modelSelector;
  tab.ui.modeSelector = toolbarComponents.modeSelector;
  tab.ui.thinkingBudgetSelector = toolbarComponents.thinkingBudgetSelector;
  tab.ui.contextUsageMeter = toolbarComponents.contextUsageMeter;
  tab.ui.externalContextSelector = toolbarComponents.externalContextSelector;
  tab.ui.mcpServerSelector = toolbarComponents.mcpServerSelector;

  tab.ui.sendButton = new InputSendButton(toolbarComponents.actionGroupEl, {
    getInputEl: () => dom.richInput,
    getIsStreaming: () => tab.state.isStreaming,
    onSend: () => {
      void tab.controllers.inputController?.sendMessage();
    },
    onStop: () => {
      tab.controllers.inputController?.cancelStreaming();
    },
  });

  tab.ui.mcpServerSelector.setMcpManager(
    plugin.getPiWorkspace()?.mcpServerManager ?? null,
  );
  tab.ui.mcpServerSelector.setRecoveryActions({
    mcpOAuth: plugin.getPiWorkspace()?.mcpOAuth ?? null,
    mcpProbeProvider: plugin.getPiWorkspace()?.mcpServerProbeProvider ?? null,
    openSettings: () => openCommunityPluginSettings(plugin),
  });

  tab.ui.fileContextManager?.setOnMcpMentionChange((servers) => {
    tab.ui.mcpServerSelector?.addMentionedServers(servers);
  });

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
