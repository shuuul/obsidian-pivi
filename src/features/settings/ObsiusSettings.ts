import type { App } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';

import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import {
  getHiddenSlashCommands,
  normalizeHiddenCommandList,
} from '../../core/agent/commands/hiddenCommands';
import { PiAgentServices } from '../../core/agent/PiAgentServices';
import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ObsiusPlugin from '../../main';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';
import { McpSettingsManager } from './ui/McpSettingsManager';

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
    if (current.scrollTop > 0 || current.scrollLeft > 0 || current.scrollHeight > current.clientHeight) {
      snapshots.push({ el: current, top: current.scrollTop, left: current.scrollLeft });
    }
    current = current.parentElement;
  }

  return snapshots;
}

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Obsius';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: 'obsius2-hotkey-item' });
  item.createSpan({
    cls: 'obsius2-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'obsius2-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => openHotkeySettings(app));
}

export class ObsiusSettingTab extends PluginSettingTab {
  plugin: ObsiusPlugin;
  private activeTab: SettingsTabId = 'general';

  constructor(app: App, plugin: ObsiusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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
    containerEl.empty();
    containerEl.addClass('obsius2-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const tabIds: SettingsTabId[] = ['general', 'chat', 'hotkeys', 'providers'];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    const tabLabels: Record<SettingsTabId, string> = {
      general: 'General',
      chat: 'Chat & prompt',
      hotkeys: 'Hotkeys & nav',
      providers: 'Providers & models',
    };

    const tabBar = containerEl.createDiv({ cls: 'obsius2-settings-tabs' });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    for (const id of tabIds) {
      const label = tabLabels[id] || id;
      const button = tabBar.createEl('button', {
        cls: `obsius2-settings-tab${id === this.activeTab ? ' obsius2-settings-tab--active' : ''}`,
        text: label,
      });
      button.addEventListener('click', () => {
        this.activeTab = id;
        for (const tabId of tabIds) {
          tabButtons.get(tabId)?.toggleClass('obsius2-settings-tab--active', tabId === id);
          tabContents.get(tabId)?.toggleClass('obsius2-settings-tab-content--active', tabId === id);
        }
      });
      tabButtons.set(id, button);
    }

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `obsius2-settings-tab-content${id === this.activeTab ? ' obsius2-settings-tab-content--active' : ''}`,
      });
      tabContents.set(id, content);
    }

    this.renderGeneralTab(tabContents.get('general')!);
    this.renderChatTab(tabContents.get('chat')!);
    this.renderHotkeysTab(tabContents.get('hotkeys')!);
    this.renderProvidersTab(tabContents.get('providers')!);
  }

  private renderGeneralTab(container: HTMLElement): void {
    new Setting(container)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
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

    // --- Display ---

    new Setting(container).setName(t('settings.display')).setHeading();

    new Setting(container)
      .setName(t('settings.tabBarPosition.name'))
      .setDesc(t('settings.tabBarPosition.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('input', t('settings.tabBarPosition.input'))
          .addOption('header', t('settings.tabBarPosition.header'))
          .setValue(this.plugin.settings.tabBarPosition ?? 'input')
          .onChange(async (value) => {
            this.plugin.settings.tabBarPosition = value as 'input' | 'header';
            await this.plugin.saveSettings();

            for (const view of this.plugin.getAllViews()) {
              view.updateLayoutForPosition();
            }
          });
      });

    const maxTabsSetting = new Setting(container)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = container.createDiv({
      cls: 'obsius2-max-tabs-warning obsius2-setting-validation obsius2-setting-validation-warning obsius2-hidden',
    });
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.toggleClass('obsius2-hidden', value <= 5);
    };

    maxTabsSetting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.maxTabs ?? 3)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTabs = value;
          await this.plugin.saveSettings();
          updateMaxTabsWarning(value);
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
          }
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    new Setting(container)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      plugin: this.plugin,
      scope: 'shared',
      heading: t('settings.environment'),
      name: 'Shared environment',
      desc: 'Runtime variables shared by the Pi agent. Use this for PATH, proxy, cert, and temp variables.',
      placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });
  }

  private renderChatTab(container: HTMLElement): void {
    // --- Conversations ---

    new Setting(container).setName(t('settings.conversations')).setHeading();

    new Setting(container)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(container)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('settings.titleModel.auto'));

          const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
          const seenValues = new Set<string>();
          const uiConfig = PiAgentServices.getChatUIConfig();
          for (const model of uiConfig.getModelOptions(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // --- Content ---

    new Setting(container).setName(t('settings.content')).setHeading();

    new Setting(container)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(container)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('obsius2-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });
  }

  private renderHotkeysTab(container: HTMLElement): void {
    // --- Input ---

    new Setting(container).setName(t('settings.input')).setHeading();

    new Setting(container)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
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
          .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', () => {
          void commitValue(true);
        });
      });

    // --- Hotkeys ---

    new Setting(container).setName(t('settings.hotkeys')).setHeading();

    const hotkeyGrid = container.createDiv({ cls: 'obsius2-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:close-current-tab', 'settings.closeTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'obsius2:add-selection-to-chat-input', 'settings.addSelectionHotkey');
  }

  private renderProvidersTab(container: HTMLElement): void {
    const workspace = AgentWorkspace.getServices();

    if (workspace?.mcpStorage) {
      new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

      const mcpDesc = container.createDiv({ cls: 'obsius2-mcp-settings-desc' });
      mcpDesc.createEl('p', {
        text: t('settings.mcpServers.desc'),
        cls: 'setting-item-description',
      });

      const mcpContainer = container.createDiv({ cls: 'obsius2-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: this.plugin.app,
        mcpStorage: workspace.mcpStorage,
        mcpOAuth: workspace.mcpOAuth,
        broadcastMcpReload: async () => {
          for (const view of this.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToAllTabs(
              (service) => service.reloadMcpServers(),
            );
          }
        },
      });
    }

    const renderer = AgentWorkspace.getSettingsTabRenderer();
    if (!renderer) {
      container.createEl('p', { text: 'Pi provider is not initialized.' });
      return;
    }

    renderer.render(container, {
      plugin: this.plugin,
      renderHiddenSlashCommandSetting: (target, copy) =>
        this.renderHiddenSlashCommandSetting(target, copy),
      refreshModelSelectors: () => {
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
        this.redisplayPreservingScroll();
      },
      renderCustomContextLimits: (target) =>
        this.renderCustomContextLimits(target),
    });
  }


  private renderHiddenSlashCommandSetting(
    container: HTMLElement,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenSlashCommands(this.plugin.settings).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenSlashCommands = normalizeHiddenCommandList(
              value.split(/\r?\n/),
            );
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenSlashCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const envVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables(),
    );
    for (const modelId of PiAgentServices.getChatUIConfig().getCustomModelIds(envVars)) {
      uniqueModelIds.add(modelId);
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'obsius2-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customContextLimits.name'),
      cls: 'obsius2-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'obsius2-context-limits-desc' });
    descEl.setText(t('settings.customContextLimits.desc'));

    const listEl = container.createDiv({ cls: 'obsius2-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];

      const itemEl = listEl.createDiv({ cls: 'obsius2-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'obsius2-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'obsius2-context-limits-input-wrapper' });
      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'obsius2-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });

      const validationEl = inputWrapper.createDiv({ cls: 'obsius2-context-limit-validation obsius2-hidden' });

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!this.plugin.settings.customContextLimits) {
          this.plugin.settings.customContextLimits = {};
        }

        if (!trimmed) {
          delete this.plugin.settings.customContextLimits[modelId];
          validationEl.toggleClass('obsius2-hidden', true);
          inputEl.classList.remove('obsius2-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('obsius2-hidden', false);
            inputEl.classList.add('obsius2-input-error');
            return;
          }

          this.plugin.settings.customContextLimits[modelId] = parsed;
          validationEl.toggleClass('obsius2-hidden', true);
          inputEl.classList.remove('obsius2-input-error');
        }

        await this.plugin.saveSettings();
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
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
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
