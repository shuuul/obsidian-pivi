import { piChatUIConfig } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import type { ChatUIConfig } from "@pivi/pivi-agent-core/foundation/chatUi";
import { Notice } from "obsidian";

import type PiviPlugin from "@/app/PiviPluginHost";

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

function openCommunityPluginSettings(plugin: PiviPlugin): void {
  const app = plugin.app;
  if (!app || typeof app !== "object" || !("setting" in app)) {
    new Notice("Open Pivi settings to manage MCP servers.");
    return;
  }
  const setting = app.setting;
  if (
    !setting ||
    typeof setting !== "object" ||
    !("open" in setting) ||
    typeof setting.open !== "function"
  ) {
    new Notice("Open Pivi settings to manage MCP servers.");
    return;
  }
  setting.open();
  if (
    "openTabById" in setting &&
    typeof setting.openTabById === "function"
  ) {
    setting.openTabById("community-plugins");
  }
}

/**
 * Creates and wires the input toolbar for a tab.
 */
export function initializeInputToolbar(
  tab: TabData,
  plugin: PiviPlugin,
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
    const baseConfig = piChatUIConfig;
    return {
      ...baseConfig,
      getModelOptions: (settings: Record<string, unknown>) =>
        piChatUIConfig.getModelOptions(settings),
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
    getEnvironmentVariables: () => plugin.getActiveEnvironmentVariables(),
    getModelReadinessProvider: () =>
      plugin.getPiWorkspace()?.modelReadinessProvider ?? null,
    onModelChange: async (model: string) => {
      if (tab.lifecycleState === "blank") {
        tab.draftModel = model;
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        syncSlashCommandDropdown(tab, plugin, getSlashCatalogConfig);

        const uiConfig = piChatUIConfig;
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
        "pivi-input-plan-mode",
        mode === "plan",
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

  tab.ui.externalContextSelector.setOnChange(() => {
    tab.ui.fileContextManager?.preScanExternalContexts();
  });

  tab.ui.externalContextSelector.setPersistentPaths(
    plugin.settings.persistentExternalContextPaths || [],
  );

  tab.ui.externalContextSelector.setOnPersistenceChange((paths) => {
    plugin.settings.persistentExternalContextPaths = paths;
    void plugin.saveSettings();
  });

  refreshTabAgentUI(tab, plugin);
  applyCapabilityUIGating(tab, plugin);
}