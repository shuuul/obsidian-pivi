import type { App } from "obsidian";
import { PluginSettingTab } from "obsidian";

import type { PiviPluginHost, PiviSettingsHost } from "@/app/hostContracts";
import type { AgentSettingsTabRendererContext } from "@/app/hostPlatform";
import type { Locale } from "@/i18n";
import { setLocale, t } from "@/i18n";

import { clearExpandedProviderCards } from "./models-settings/expandedProviderCards";
import { getScrollableAncestors } from "./piviSettingsHotkeys";
import {
  type PiviSettingsTabRenderContext,
  renderCommandsTab,
  renderGeneralTab,
  renderIntegrationsTab,
  renderMcpTab,
  renderModelsTab,
  renderSkillsTab,
  renderSubagentsTab,
  renderToolsTab,
} from "./piviSettingsTabs";
import type { McpSettingsManager } from "./ui/McpSettingsManager";
import type { SlashCommandSettingsManager } from "./ui/SlashCommandSettingsManager";
import { renderWebSearchTab } from "./webSearchTab";

type SettingsTabId = string;

export class PiviSettingTab extends PluginSettingTab {
  /** Full plugin host — required for PluginSettingTab / Obsidian Plugin APIs. */
  plugin: PiviPluginHost;
  private activeTab: SettingsTabId = "general";
  private mcpSettingsManager: McpSettingsManager | null = null;
  private slashCommandSettingsManager: SlashCommandSettingsManager | null =
    null;

  constructor(app: App, plugin: PiviPluginHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private disposeMcpSettingsManager(): void {
    this.mcpSettingsManager?.dispose();
    this.mcpSettingsManager = null;
  }

  private disposeSlashCommandSettingsManager(): void {
    this.slashCommandSettingsManager?.dispose();
    this.slashCommandSettingsManager = null;
  }

  private disposeSettingsManagers(): void {
    this.disposeMcpSettingsManager();
    this.disposeSlashCommandSettingsManager();
  }

  private redisplayPreservingScroll(): void {
    const snapshots = getScrollableAncestors(this.containerEl);
    this.renderSettings();
    window.requestAnimationFrame(() => {
      for (const snapshot of snapshots) {
        snapshot.el.scrollTo({ top: snapshot.top, left: snapshot.left });
      }
    });
  }

  private createTabRenderContext(): PiviSettingsTabRenderContext {
    const settingsHost: PiviSettingsHost = this.plugin;
    return {
      app: this.app,
      plugin: settingsHost,
      redisplay: () => this.renderSettings(),
      redisplayPreservingScroll: () => this.redisplayPreservingScroll(),
      createAgentSettingsRendererContext: (onEnvironmentChanged) =>
        this.createAgentSettingsRendererContext(onEnvironmentChanged),
      restartServiceForPromptChange: () => this.restartServiceForPromptChange(),
      setMcpSettingsManager: (manager) => {
        this.mcpSettingsManager = manager;
      },
      setSlashCommandSettingsManager: (manager) => {
        this.slashCommandSettingsManager = manager;
      },
    };
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    this.disposeSettingsManagers();
    containerEl.empty();
    containerEl.addClass("pivi-settings");

    setLocale(this.plugin.settings.locale as Locale);
    const tabIds: SettingsTabId[] = [
      "general",
      "models",
      "skills",
      "tools",
      "subagents",
      "webSearch",
      "commands",
      "mcp",
      "integrations",
    ];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = "general";
    }

    const tabLabels: Record<SettingsTabId, string> = {
      general: t("settings.tabs.general"),
      models: t("settings.tabs.models"),
      skills: t("settings.tabs.skills"),
      tools: t("settings.tabs.tools"),
      subagents: t("settings.tabs.subagents"),
      webSearch: t("settings.tabs.webSearch"),
      commands: t("settings.tabs.commands"),
      integrations: t("settings.tabs.integrations"),
      mcp: t("settings.tabs.mcp"),
    };

    const tabBar = containerEl.createDiv({ cls: "pivi-settings-tabs" });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    for (const id of tabIds) {
      const label = tabLabels[id] || id;
      const button = tabBar.createEl("button", {
        cls: `pivi-settings-tab${id === this.activeTab ? " pivi-settings-tab--active" : ""}`,
        text: label,
      });
      button.addEventListener("click", () => {
        this.activeTab = id;
        for (const tabId of tabIds) {
          tabButtons
            .get(tabId)
            ?.toggleClass("pivi-settings-tab--active", tabId === id);
          tabContents
            .get(tabId)
            ?.toggleClass("pivi-settings-tab-content--active", tabId === id);
        }
      });
      tabButtons.set(id, button);
    }

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `pivi-settings-tab-content${id === this.activeTab ? " pivi-settings-tab-content--active" : ""}`,
      });
      tabContents.set(id, content);
    }

    const ctx = this.createTabRenderContext();
    renderGeneralTab(ctx, tabContents.get("general")!);
    renderModelsTab(ctx, tabContents.get("models")!);
    renderSkillsTab(ctx, tabContents.get("skills")!);
    renderToolsTab(ctx, tabContents.get("tools")!);
    renderSubagentsTab(ctx, tabContents.get("subagents")!);
    renderWebSearchTab(ctx, tabContents.get("webSearch")!);
    renderCommandsTab(ctx, tabContents.get("commands")!);
    renderIntegrationsTab(ctx, tabContents.get("integrations")!);
    renderMcpTab(ctx, tabContents.get("mcp")!);
  }

  hide(): void {
    this.disposeSettingsManagers();
    clearExpandedProviderCards();
    super.hide();
  }

  private createAgentSettingsRendererContext(
    onEnvironmentChanged?: () => void,
  ): AgentSettingsTabRendererContext {
    return {
      host: this.plugin.getAgentHostContext(),
      refreshModelSelectors: () => {
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
        this.redisplayPreservingScroll();
      },
      onEnvironmentChanged,
    };
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(async (service) => {
        if (service.syncSystemPrompt) {
          await service.syncSystemPrompt();
          return;
        }
        await service.ensureReady({ force: true });
      });
    } catch {
      // Changes will apply on the next openSession if the restart fails.
    }
  }
}
