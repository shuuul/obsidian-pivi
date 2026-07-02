import type { ChatViewPlacement } from "@pivi/core/settings";
import type { AgentSettingsTabRendererContext } from "@pivi/obsidian-host/serviceContracts";
import { piChatUIConfig } from "@pivi/pi-runtime/PiChatUIConfig";
import type { App } from "obsidian";
import { Notice, Platform, PluginSettingTab, Setting } from "obsidian";

import type { PiviPluginHost as PiviPlugin } from '@/app/PiviPluginHost';
import type { Locale, TranslationKey } from "@/i18n";
import {
  getAvailableLocales,
  getLocaleDisplayName,
  setLocale,
  t,
} from "@/i18n";

import { buildNavMappingText, parseNavMappings } from "./keyboardNavigation";
import { renderEnvironmentSettingsSection } from "./ui/EnvironmentSettingsSection";
import { McpSettingsManager } from "./ui/McpSettingsManager";
import { SlashCommandSettingsManager } from "./ui/SlashCommandSettingsManager";

type SettingsTabId = string;
type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};
type ScrollSnapshot = {
  el: HTMLElement;
  top: number;
  left: number;
};
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

function getScrollableAncestors(el: HTMLElement): ScrollSnapshot[] {
  const snapshots: ScrollSnapshot[] = [];
  let current: HTMLElement | null = el;

  while (current) {
    if (
      current.scrollTop > 0 ||
      current.scrollLeft > 0 ||
      current.scrollHeight > current.clientHeight
    ) {
      snapshots.push({
        el: current,
        top: current.scrollTop,
        left: current.scrollLeft,
      });
    }
    current = current.parentElement;
  }

  return snapshots;
}

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join("") : [...mods, key].join("+");
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById("hotkeys");
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = "Pivi";
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys =
    customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(", ");
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: "pivi-hotkey-item" });
  item.createSpan({
    cls: "pivi-hotkey-name",
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: "pivi-hotkey-badge", text: hotkey });
  }
  item.addEventListener("click", () => openHotkeySettings(app));
}

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

  display(): void {
    const { containerEl } = this;
    this.disposeSettingsManagers();
    containerEl.empty();
    containerEl.addClass("pivi-settings");

    setLocale(this.plugin.settings.locale as Locale);

    const tabIds: SettingsTabId[] = [
      "general",
      "models",
      "commands",
      "mcp",
    ];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = "general";
    }

    const tabLabels: Record<SettingsTabId, string> = {
      general: t("settings.tabs.general"),
      models: t("settings.tabs.models"),
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

    this.renderGeneralTab(tabContents.get("general")!);
    this.renderModelsTab(tabContents.get("models")!);
    this.renderCommandsTab(tabContents.get("commands")!);
    this.renderMcpTab(tabContents.get("mcp")!);
  }

  hide(): void {
    this.disposeSettingsManagers();
    super.hide();
  }

  private renderGeneralTab(container: HTMLElement): void {
    new Setting(container)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(container).setName(t("settings.layout")).setHeading();

    new Setting(container)
      .setName(t("settings.chatViewPlacement.name"))
      .setDesc(t("settings.chatViewPlacement.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption(
            "right-sidebar",
            t("settings.chatViewPlacement.rightSidebar"),
          )
          .addOption(
            "left-sidebar",
            t("settings.chatViewPlacement.leftSidebar"),
          )
          .addOption("main-tab", t("settings.chatViewPlacement.mainTab"))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t("settings.tabBarPosition.name"))
      .setDesc(t("settings.tabBarPosition.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("input", "Above input")
          .addOption("header", "In header")
          .setValue(this.plugin.settings.tabBarPosition ?? "input")
          .onChange(async (value) => {
            this.plugin.settings.tabBarPosition = value as "input" | "header";
            await this.plugin.saveSettings();

            for (const view of this.plugin.getAllViews()) {
              view.updateLayoutForPosition();
            }
          });
      });

    this.renderChatBehaviorSection(container);
    this.renderSessionFilesSection(container);
    this.renderPersonalizationContextSection(container);
    this.renderInputShortcutsSection(container);
    this.renderEnvironmentSection(container);
  }

  private renderSessionFilesSection(container: HTMLElement): void {
    new Setting(container).setName("Session files").setHeading();

    new Setting(container)
      .setName("Delete removed session files")
      .setDesc("Permanently deletes only session files that were removed from history and are not archived or currently open.")
      .addButton((button) => {
        button
          .setButtonText("Delete removed files")
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true);
            try {
              const deletedCount = await this.plugin.purgeDeletedSessionFiles();
              new Notice(`Deleted ${deletedCount} removed session file${deletedCount === 1 ? "" : "s"}.`);
            } catch {
              new Notice("Failed to delete removed session files");
            } finally {
              button.setDisabled(false);
            }
          });
      });
  }

  private renderChatBehaviorSection(container: HTMLElement): void {
    new Setting(container).setName(t("settings.chatBehavior")).setHeading();

    new Setting(container)
      .setName(t("settings.enableAutoScroll.name"))
      .setDesc(t("settings.enableAutoScroll.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(container)
      .setName(t("settings.deferMathRenderingDuringStreaming.name"))
      .setDesc(t("settings.deferMathRenderingDuringStreaming.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(
            this.plugin.settings.deferMathRenderingDuringStreaming ?? true,
          )
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(container)
      .setName(t("settings.autoTitle.name"))
      .setDesc(t("settings.autoTitle.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(container)
        .setName(t("settings.titleModel.name"))
        .setDesc(t("settings.titleModel.desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("", t("settings.titleModel.auto"));

          const settingsBag = this.plugin.settings as unknown as Record<
            string,
            unknown
          >;
          const seenValues = new Set<string>();
          const uiConfig = piChatUIConfig;
          for (const model of uiConfig.getModelOptions(settingsBag)) {
            if (!seenValues.has(model.value)) {
              seenValues.add(model.value);
              dropdown.addOption(model.value, model.label);
            }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || "")
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }
  }

  private renderPersonalizationContextSection(container: HTMLElement): void {
    new Setting(container)
      .setName(t("settings.personalizationContext"))
      .setHeading();

    new Setting(container)
      .setName(t("settings.userName.name"))
      .setDesc(t("settings.userName.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.userName.name"))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t("settings.excludedTags.name"))
      .setDesc(t("settings.excludedTags.desc"))
      .addTextArea((text) => {
        text
          .setPlaceholder("System\nprivate\ndraft")
          .setValue(this.plugin.settings.excludedTags.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ""))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderInputShortcutsSection(container: HTMLElement): void {
    new Setting(container).setName(t("settings.inputShortcuts")).setHeading();

    new Setting(container)
      .setName(t("settings.requireCommandOrControlEnterToSend.name"))
      .setDesc(t("settings.requireCommandOrControlEnterToSend.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(
            this.plugin.settings.requireCommandOrControlEnterToSend ?? false,
          )
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t("settings.navMappings.name"))
      .setDesc(t("settings.navMappings.desc"))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(
          this.plugin.settings.keyboardNavigation,
        );
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t("common.error")}: ${result.error}`);
              pendingValue = buildNavMappingText(
                this.plugin.settings.keyboardNavigation,
              );
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey =
            result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey =
            result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey =
            result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(
            this.plugin.settings.keyboardNavigation,
          );
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder("Map w scrollup\nmap s scrolldown\nmap i focusinput")
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener("blur", () => {
          void commitValue(true);
        });
      });

    const hotkeyGrid = container.createDiv({ cls: "pivi-hotkey-grid" });
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:inline-edit",
      "settings.inlineEditHotkey",
    );
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:open-view",
      "settings.openChatHotkey",
    );
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:new-session",
      "settings.newSessionHotkey",
    );
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:new-tab",
      "settings.newTabHotkey",
    );
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:close-current-tab",
      "settings.closeTabHotkey",
    );
    addHotkeySettingRow(
      hotkeyGrid,
      this.app,
      "pivi:add-selection-to-chat-input",
      "settings.addSelectionHotkey",
    );
  }

  private renderEnvironmentSection(container: HTMLElement): void {
    new Setting(container).setName(t("settings.environment")).setHeading();

    renderEnvironmentSettingsSection({
      container,
      plugin: this.plugin,
      scope: "shared",
      name: "Shared environment",
      desc: "Runtime variables shared by the Pi agent. Use this for PATH, proxy, cert, and temp variables.",
      placeholder:
        "PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem",
    });
  }

  private renderModelsTab(container: HTMLElement): void {
    const context = this.createAgentSettingsRendererContext();
    this.plugin.getPiWorkspace()?.settingsTabRenderer?.renderModels(container, context);
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

  private renderCommandsTab(container: HTMLElement): void {
    const desc = container.createDiv({ cls: "pivi-sp-settings-desc" });
    desc.createEl("p", {
      text: t("settings.slashCommands.desc"),
      cls: "setting-item-description",
    });

    const catalog = this.plugin.getPiWorkspace()?.slashCommandCatalog ?? null;
    if (!catalog) {
      container.createEl("p", {
        cls: "pivi-sp-empty-state",
        text: "Slash command catalog is not initialized.",
      });
    } else {
      const commandContainer = container.createDiv({
        cls: "pivi-slash-settings-container",
      });
      this.slashCommandSettingsManager = new SlashCommandSettingsManager(
        commandContainer,
        {
          app: this.plugin.app,
          catalog,
          onCommandsChanged: () => {
            for (const view of this.plugin.getAllViews()) {
              view.invalidateSlashCommandCaches();
            }
          },
        },
      );
      this.slashCommandSettingsManager.render();
    }

  }

  private renderMcpTab(container: HTMLElement): void {
    const workspace = this.plugin.getPiWorkspace();

    if (workspace?.mcpStorage) {
      const mcpDesc = container.createDiv({ cls: "pivi-mcp-settings-desc" });
      mcpDesc.createEl("p", {
        text: t("settings.mcpServers.desc"),
        cls: "setting-item-description",
      });

      const mcpContainer = container.createDiv({ cls: "pivi-mcp-container" });
      this.mcpSettingsManager = new McpSettingsManager(mcpContainer, {
        app: this.plugin.app,
        mcpStorage: workspace.mcpStorage,
        mcpOAuth: workspace.mcpOAuth,
        mcpServerTester: workspace.mcpServerTester,
        broadcastMcpReload: async () => {
          for (const view of this.plugin.getAllViews()) {
            await view
              .getTabManager()
              ?.broadcastToAllTabs((service) => service.reloadMcpServers());
          }
        },
      });
    }
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
