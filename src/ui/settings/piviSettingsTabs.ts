import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host";
import type { AgentSettingsTabRendererContext } from "@pivi/obsidian-host/serviceContracts";
import { piChatUIConfig } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import {
  type ChatViewPlacement,
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
} from "@pivi/pivi-agent-core/foundation/settings";
import type { App } from "obsidian";
import { Notice, Setting } from "obsidian";

import type { PiviPluginHost as PiviPlugin } from "@/app/PiviPluginHost";
import type { Locale } from "@/i18n";
import {
  getAvailableLocales,
  getLocaleDisplayName,
  setLocale,
  t,
} from "@/i18n";

import { buildNavMappingText, parseNavMappings } from "./keyboardNavigation";
import {
  addHotkeySettingRow,
  TOOL_SETTINGS_ROWS,
} from "./piviSettingsHotkeys";
import { renderEnvironmentSettingsSection } from "./ui/EnvironmentSettingsSection";
import { renderExternalReadSettingsSection } from "./ui/ExternalReadSettingsSection";
import { McpSettingsManager } from "./ui/McpSettingsManager";
import { SlashCommandSettingsManager } from "./ui/SlashCommandSettingsManager";
import { renderSubagentSettingsSection } from "./ui/SubagentSettingsSection";

export type PiviSettingsTabRenderContext = {
  app: App;
  plugin: PiviPlugin;
  redisplay: () => void;
  redisplayPreservingScroll: () => void;
  createAgentSettingsRendererContext: (
    onEnvironmentChanged?: () => void,
  ) => AgentSettingsTabRendererContext;
  restartServiceForPromptChange: () => Promise<void>;
  setMcpSettingsManager: (manager: McpSettingsManager | null) => void;
  setSlashCommandSettingsManager: (
    manager: SlashCommandSettingsManager | null,
  ) => void;
};

export function renderGeneralTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t("settings.language.name"))
    .setDesc(t("settings.language.desc"))
    .addDropdown((dropdown) => {
      const locales = getAvailableLocales();
      for (const locale of locales) {
        dropdown.addOption(locale, getLocaleDisplayName(locale));
      }
      dropdown
        .setValue(ctx.plugin.settings.locale)
        .onChange(async (value) => {
          const locale = value as Locale;
          if (!setLocale(locale)) {
            dropdown.setValue(ctx.plugin.settings.locale);
            return;
          }
          ctx.plugin.settings.locale = locale;
          await ctx.plugin.saveSettings();
          ctx.redisplay();
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
        .setValue(ctx.plugin.settings.chatViewPlacement)
        .onChange(async (value) => {
          ctx.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
          await ctx.plugin.saveSettings();
        });
    });

  new Setting(container)
    .setName(t("settings.tabBarPosition.name"))
    .setDesc(t("settings.tabBarPosition.desc"))
    .addDropdown((dropdown) => {
      dropdown
        .addOption("input", "Above input")
        .addOption("header", "In header")
        .setValue(ctx.plugin.settings.tabBarPosition ?? "input")
        .onChange(async (value) => {
          ctx.plugin.settings.tabBarPosition = value as "input" | "header";
          await ctx.plugin.saveSettings();

          for (const view of ctx.plugin.getAllViews()) {
            view.updateLayoutForPosition();
          }
        });
    });

  renderChatBehaviorSection(ctx, container);
  renderCompactionSection(ctx, container);
  renderSessionFilesSection(ctx, container);
  renderPersonalizationContextSection(ctx, container);
  renderInputShortcutsSection(ctx, container);
  renderEnvironmentSection(ctx, container);
}

function renderCompactionSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName(t("settings.compaction.title")).setHeading();

  new Setting(container)
    .setName(t("settings.compaction.autoCompact.name"))
    .setDesc(t("settings.compaction.autoCompact.desc"))
    .addToggle((toggle) => {
      toggle
        .setValue(ctx.plugin.settings.enableAutoCompact)
        .onChange(async (value) => {
          ctx.plugin.settings.enableAutoCompact = value;
          await ctx.plugin.saveSettings();
          ctx.redisplayPreservingScroll();
        });
    });

  new Setting(container)
    .setName(t("settings.compaction.threshold.name"))
    .setDesc(t("settings.compaction.threshold.desc"))
    .addSlider((slider) => {
      slider
        .setLimits(50, 95, 5)
        .setValue(Math.round((ctx.plugin.settings.autoCompactThresholdRatio ?? 0.9) * 100))
        .onChange(async (value) => {
          ctx.plugin.settings.autoCompactThresholdRatio = value / 100;
          await ctx.plugin.saveSettings();
        });
    });

  new Setting(container)
    .setName(t("settings.compaction.keepRecent.name"))
    .setDesc(t("settings.compaction.keepRecent.desc"))
    .addText((text) => {
      text
        .setPlaceholder("20000")
        .setValue(String(ctx.plugin.settings.autoCompactKeepRecentTokens ?? 20_000))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
          if (!Number.isFinite(parsed)) {
            return;
          }
          ctx.plugin.settings.autoCompactKeepRecentTokens = Math.min(200_000, Math.max(1_000, parsed));
          await ctx.plugin.saveSettings();
        });
      text.inputEl.type = "number";
      text.inputEl.min = "1000";
      text.inputEl.max = "200000";
      text.inputEl.step = "1000";
    });
}

function renderSessionFilesSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName("Session files").setHeading();

  new Setting(container)
    .setName("Delete removed session files")
    .setDesc("Permanently deletes only session files that were removed from history and are not archived or currently open.")
    .addButton((button) => {
      button
        .setButtonText("Delete removed files")
        .setClass("mod-warning")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const deletedCount = await ctx.plugin.purgeDeletedSessionFiles();
            new Notice(`Deleted ${deletedCount} removed session file${deletedCount === 1 ? "" : "s"}.`);
          } catch {
            new Notice("Failed to delete removed session files");
          } finally {
            button.setDisabled(false);
          }
        });
    });
}

function renderChatBehaviorSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName(t("settings.chatBehavior")).setHeading();

  new Setting(container)
    .setName(t("settings.enableAutoScroll.name"))
    .setDesc(t("settings.enableAutoScroll.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.plugin.settings.enableAutoScroll ?? true)
        .onChange(async (value) => {
          ctx.plugin.settings.enableAutoScroll = value;
          await ctx.plugin.saveSettings();
        }),
    );

  new Setting(container)
    .setName(t("settings.deferMathRenderingDuringStreaming.name"))
    .setDesc(t("settings.deferMathRenderingDuringStreaming.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(
          ctx.plugin.settings.deferMathRenderingDuringStreaming ?? true,
        )
        .onChange(async (value) => {
          ctx.plugin.settings.deferMathRenderingDuringStreaming = value;
          await ctx.plugin.saveSettings();
        }),
    );

  new Setting(container)
    .setName(t("settings.autoTitle.name"))
    .setDesc(t("settings.autoTitle.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.plugin.settings.enableAutoTitleGeneration)
        .onChange(async (value) => {
          ctx.plugin.settings.enableAutoTitleGeneration = value;
          await ctx.plugin.saveSettings();
          ctx.redisplay();
        }),
    );

  if (ctx.plugin.settings.enableAutoTitleGeneration) {
    new Setting(container)
      .setName(t("settings.titleModel.name"))
      .setDesc(t("settings.titleModel.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("settings.titleModel.auto"));

        const settingsBag = ctx.plugin.settings as unknown as Record<
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
          .setValue(ctx.plugin.settings.titleGenerationModel || "")
          .onChange(async (value) => {
            ctx.plugin.settings.titleGenerationModel = value;
            await ctx.plugin.saveSettings();
          });
      });
  }
}

function renderPersonalizationContextSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t("settings.personalizationContext"))
    .setHeading();

  new Setting(container)
    .setName(t("settings.userName.name"))
    .setDesc(t("settings.userName.desc"))
    .addText((text) => {
      text
        .setPlaceholder(t("settings.userName.name"))
        .setValue(ctx.plugin.settings.userName)
        .onChange(async (value) => {
          ctx.plugin.settings.userName = value;
          await ctx.plugin.saveSettings();
        });
      text.inputEl.addEventListener("blur", () => {
        void ctx.restartServiceForPromptChange();
      });
    });

  new Setting(container)
    .setName(t("settings.excludedTags.name"))
    .setDesc(t("settings.excludedTags.desc"))
    .addTextArea((text) => {
      text
        .setPlaceholder("System\nprivate\ndraft")
        .setValue(ctx.plugin.settings.excludedTags.join("\n"))
        .onChange(async (value) => {
          ctx.plugin.settings.excludedTags = value
            .split(/\r?\n/)
            .map((entry) => entry.trim().replace(/^#/, ""))
            .filter((entry) => entry.length > 0);
          await ctx.plugin.saveSettings();
        });
      text.inputEl.rows = 4;
      text.inputEl.cols = 30;
    });
}

function renderInputShortcutsSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName(t("settings.inputShortcuts")).setHeading();

  new Setting(container)
    .setName(t("settings.requireCommandOrControlEnterToSend.name"))
    .setDesc(t("settings.requireCommandOrControlEnterToSend.desc"))
    .addToggle((toggle) => {
      toggle
        .setValue(
          ctx.plugin.settings.requireCommandOrControlEnterToSend ?? false,
        )
        .onChange(async (value) => {
          ctx.plugin.settings.requireCommandOrControlEnterToSend = value;
          await ctx.plugin.saveSettings();
        });
    });

  new Setting(container)
    .setName(t("settings.navMappings.name"))
    .setDesc(t("settings.navMappings.desc"))
    .addTextArea((text) => {
      let pendingValue = buildNavMappingText(
        ctx.plugin.settings.keyboardNavigation,
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
              ctx.plugin.settings.keyboardNavigation,
            );
            text.setValue(pendingValue);
          }
          return;
        }

        ctx.plugin.settings.keyboardNavigation.scrollUpKey =
          result.settings.scrollUp;
        ctx.plugin.settings.keyboardNavigation.scrollDownKey =
          result.settings.scrollDown;
        ctx.plugin.settings.keyboardNavigation.focusInputKey =
          result.settings.focusInput;
        await ctx.plugin.saveSettings();
        pendingValue = buildNavMappingText(
          ctx.plugin.settings.keyboardNavigation,
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
    ctx.app,
    "pivi:inline-edit",
    "settings.inlineEditHotkey",
  );
  addHotkeySettingRow(
    hotkeyGrid,
    ctx.app,
    "pivi:open-view",
    "settings.openChatHotkey",
  );
  addHotkeySettingRow(
    hotkeyGrid,
    ctx.app,
    "pivi:new-session",
    "settings.newSessionHotkey",
  );
  addHotkeySettingRow(
    hotkeyGrid,
    ctx.app,
    "pivi:new-tab",
    "settings.newTabHotkey",
  );
  addHotkeySettingRow(
    hotkeyGrid,
    ctx.app,
    "pivi:close-current-tab",
    "settings.closeTabHotkey",
  );
  addHotkeySettingRow(
    hotkeyGrid,
    ctx.app,
    "pivi:add-selection-to-chat-input",
    "settings.addSelectionHotkey",
  );
}

function renderEnvironmentSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName(t("settings.environment")).setHeading();

  renderEnvironmentSettingsSection({
    container,
    plugin: ctx.plugin,
    scope: "shared",
    name: "Shared environment",
    desc: "Runtime variables shared by the Pi agent. Use this for PATH, proxy, cert, and temp variables.",
    placeholder:
      "PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem",
  });
}

export function renderModelsTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const context = ctx.createAgentSettingsRendererContext();
  ctx.plugin.getPiWorkspace()?.settingsTabRenderer?.renderModels(container, context);
}

export function renderSkillsTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const context = ctx.createAgentSettingsRendererContext();
  ctx.plugin.getPiWorkspace()?.settingsTabRenderer?.renderSkills(container, context);
}

async function setToolEnabled(
  ctx: PiviSettingsTabRenderContext,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  const agentSettings = ctx.plugin.settings.agentSettings;
  const current = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  const disabled = new Set(current.disabledTools ?? []);
  if (enabled) {
    disabled.delete(toolName);
  } else {
    disabled.add(toolName);
  }
  agentSettings.obsidianTools = {
    ...current,
    disabledTools: [...disabled].sort(),
  };
  await ctx.plugin.saveSettings();
  await ctx.restartServiceForPromptChange();
}

export function renderToolsTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const desc = container.createDiv({ cls: "pivi-sp-settings-desc" });
  desc.createEl("p", {
    cls: "setting-item-description",
    text: "Enable or disable Obsidian tools exposed to the agent. Changes apply to new turns after the agent prompt refreshes.",
  });

  const toolSettings = getObsidianToolsSettingsFromBag(ctx.plugin.settings);
  const disabledTools = new Set(toolSettings.disabledTools ?? []);
  const hasCodexCredential = ctx.plugin.getPiWorkspace()?.providerOAuth?.hasCodexAuth() ?? false;
  const officialCliEnabled = isOfficialObsidianCliEnabled();
  const externalReadAvailable = toolSettings.allowExternalRead && toolSettings.externalReadDirectories.length > 0;

  renderExternalReadSettingsSection({
    container,
    plugin: ctx.plugin,
    restartServiceForPromptChange: ctx.restartServiceForPromptChange,
    onSettingsChanged: ctx.redisplayPreservingScroll,
  });

  for (const row of TOOL_SETTINGS_ROWS) {
    const missingCodex = row.requiresCodex && !hasCodexCredential;
    const missingCli = row.requiresOfficialCli && !officialCliEnabled;
    const missingExternalRead = row.requiresExternalRead && !externalReadAvailable;
    const unavailable = missingCodex || missingCli || missingExternalRead;
    const enabled = !unavailable && !disabledTools.has(row.name);
    const description = missingCli
      ? `${row.description} Enable Obsidian's official CLI in Obsidian Settings → General → Command line interface, then reopen Pivi settings.`
      : missingCodex
        ? `${row.description} Connect the openai-codex provider first to enable this tool.`
        : missingExternalRead
          ? `${row.description} Enable external file read/list and add at least one allowed directory above, or select an external context folder in a chat session, to make this tool available.`
          : row.description;

    new Setting(container)
      .setName(`${row.label} (${row.name})`)
      .setDesc(description)
      .addToggle((toggle) => {
        toggle
          .setValue(enabled)
          .setDisabled(Boolean(unavailable))
          .onChange(async (value) => {
            if (unavailable) {
              toggle.setValue(false);
              return;
            }
            await setToolEnabled(ctx, row.name, value);
          });
      });
  }

}

export function renderSubagentsTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  renderSubagentSettingsSection({
    container,
    plugin: ctx.plugin,
    restartServiceForPromptChange: ctx.restartServiceForPromptChange,
  });
}

export function renderCommandsTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const desc = container.createDiv({ cls: "pivi-sp-settings-desc" });
  desc.createEl("p", {
    text: t("settings.slashCommands.desc"),
    cls: "setting-item-description",
  });

  const catalog = ctx.plugin.getPiWorkspace()?.slashCommandCatalog ?? null;
  if (!catalog) {
    container.createEl("p", {
      cls: "pivi-sp-empty-state",
      text: "Slash command catalog is not initialized.",
    });
  } else {
    const commandContainer = container.createDiv({
      cls: "pivi-slash-settings-container",
    });
    const manager = new SlashCommandSettingsManager(commandContainer, {
      app: ctx.plugin.app,
      catalog,
      onCommandsChanged: () => {
        for (const view of ctx.plugin.getAllViews()) {
          view.invalidateSlashCommandCaches();
        }
      },
    });
    ctx.setSlashCommandSettingsManager(manager);
    manager.render();
  }
}

export function renderMcpTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const workspace = ctx.plugin.getPiWorkspace();

  if (workspace?.mcpStorage) {
    const mcpDesc = container.createDiv({ cls: "pivi-mcp-settings-desc" });
    mcpDesc.createEl("p", {
      text: t("settings.mcpServers.desc"),
      cls: "setting-item-description",
    });

    const mcpContainer = container.createDiv({ cls: "pivi-mcp-container" });
    const manager = new McpSettingsManager(mcpContainer, {
      app: ctx.plugin.app,
      mcpStorage: workspace.mcpStorage,
      mcpOAuth: workspace.mcpOAuth,
      mcpServerTester: workspace.mcpServerTester,
      broadcastMcpReload: async () => {
        for (const view of ctx.plugin.getAllViews()) {
          await view
            .getTabManager()
            ?.broadcastToAllTabs((service) => service.reloadMcpServers());
        }
      },
    });
    ctx.setMcpSettingsManager(manager);
  }
}


export { renderWebSearchTab } from "./webSearchTab";
