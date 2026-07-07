import type { AgentSettingsTabRendererContext } from "@pivi/obsidian-host/serviceContracts";
import type { App } from "obsidian";
import { PluginSettingTab } from "obsidian";

import type { PiviPluginHost as PiviPlugin } from "@/app/PiviPluginHost";
import type { Locale } from "@/i18n";
import { setLocale, t } from "@/i18n";

import { getScrollableAncestors } from "./piviSettingsHotkeys";
import {
  type PiviSettingsTabRenderContext,
  renderCommandsTab,
  renderGeneralTab,
  renderMcpTab,
  renderModelsTab,
  renderSkillsTab,
  renderSubagentsTab,
  renderToolsTab,
  renderWebSearchTab,
} from "./piviSettingsTabs";
import type { McpSettingsManager } from "./ui/McpSettingsManager";
import type { SlashCommandSettingsManager } from "./ui/SlashCommandSettingsManager";

type SettingsTabId = string;

export class PiviSettingTab extends PluginSettingTab {
  plugin: PiviPlugin;
  private activeTab: SettingsTabId = "general";
  private mcpSettingsManager: McpSettingsManager | null = null;
  private slashCommandSettingsManager: SlashCommandSettingsManager | null =
    null;

  constructor(app: App, plugin: PiviPlugin) {
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
    this.display();
    window.requestAnimationFrame(() => {
      for (const snapshot of snapshots) {
        snapshot.el.scrollTo({ top: snapshot.top, left: snapshot.left });
      }
    });
  }

  private createTabRenderContext(): PiviSettingsTabRenderContext {
    return {
      app: this.app,
      plugin: this.plugin,
      redisplay: () => this.display(),
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
    renderMcpTab(ctx, tabContents.get("mcp")!);
  }

  hide(): void {
    this.disposeSettingsManagers();
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
