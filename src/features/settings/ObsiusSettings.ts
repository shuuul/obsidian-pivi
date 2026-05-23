import type { App } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ObsiusPlugin from '../../main';
import { getPiProviderSettings, updatePiProviderSettings } from '../../providers/pi/settings';
import { getPiAiModelsForProvider, PI_AI_MODELS_CACHE } from '../../providers/pi/ui/PiChatUIConfig';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';

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
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

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
      chat: 'Chat & Prompt',
      hotkeys: 'Hotkeys & Nav',
      providers: 'Providers & Models',
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
      desc: 'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
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
          for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
            const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
            for (const model of uiConfig.getModelOptions(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
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
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
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
  }

  private renderProvidersTab(container: HTMLElement): void {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const piSettings = getPiProviderSettings(settingsBag);

    const PROVIDER_NAMES: Record<string, string> = {
      'amazon-bedrock': 'Amazon Bedrock',
      'anthropic': 'Anthropic',
      'azure-openai-responses': 'Azure OpenAI',
      'cerebras': 'Cerebras',
      'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
      'cloudflare-workers-ai': 'Cloudflare Workers AI',
      'deepseek': 'DeepSeek',
      'fireworks': 'Fireworks AI',
      'github-copilot': 'GitHub Copilot',
      'google': 'Google Gemini',
      'google-vertex': 'Google Cloud Vertex AI',
      'groq': 'Groq',
      'huggingface': 'Hugging Face',
      'kimi-coding': 'Kimi for Coding',
      'minimax': 'MiniMax',
      'minimax-cn': 'MiniMax China',
      'mistral': 'Mistral AI',
      'moonshotai': 'Moonshot AI',
      'moonshotai-cn': 'Moonshot AI (China)',
      'openai': 'OpenAI',
      'openai-codex': 'OpenAI Codex',
      'opencode': 'OpenCode',
      'opencode-go': 'OpenCode-Go',
      'openrouter': 'OpenRouter',
      'together': 'Together AI',
      'vercel-ai-gateway': 'Vercel AI Gateway',
      'xai': 'xAI Grok',
      'xiaomi': 'Xiaomi MiMo',
      'xiaomi-token-plan-ams': 'Xiaomi MiMo (AMS)',
      'xiaomi-token-plan-cn': 'Xiaomi MiMo (China)',
      'xiaomi-token-plan-sgp': 'Xiaomi MiMo (SGP)',
      'zai': 'ZAI',
    };

    const getProviderDisplayName = (id: string): string => {
      if (PROVIDER_NAMES[id]) {
        return PROVIDER_NAMES[id];
      }
      return id
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    const getProviderEnvVars = (id: string): { apiKeyVar: string; oauthVar?: string } => {
      if (id === 'anthropic') {
        return { apiKeyVar: 'ANTHROPIC_API_KEY', oauthVar: 'ANTHROPIC_OAUTH_TOKEN' };
      }
      if (id === 'google' || id === 'gemini') {
        return { apiKeyVar: 'GEMINI_API_KEY' };
      }
      if (id === 'github-copilot') {
        return { apiKeyVar: 'COPILOT_GITHUB_TOKEN' };
      }
      if (id === 'google-vertex') {
        return { apiKeyVar: 'GOOGLE_CLOUD_API_KEY' };
      }
      if (id === 'huggingface') {
        return { apiKeyVar: 'HF_TOKEN' };
      }
      
      const prefix = id.replace(/-/g, '_').toUpperCase();
      return { apiKeyVar: `${prefix}_API_KEY` };
    };

    const getEnvVarValue = (envStr: string, varName: string): string => {
      const env = parseEnvironmentVariables(envStr);
      return env[varName] || '';
    };

    const setEnvVarValue = (envStr: string, varName: string, value: string): string => {
      const env = parseEnvironmentVariables(envStr);
      if (value.trim()) {
        env[varName] = value.trim();
      } else {
        delete env[varName];
      }
      return Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    };

    // Pi Coding Agent Setup
    new Setting(container).setName('Pi coding agent setup').setHeading();

    new Setting(container)
      .setName('Enable Pi coding agent')
      .setDesc('Launch `pi --mode rpc` as a provider.')
      .addToggle((toggle) =>
        toggle
          .setValue(piSettings.enabled)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { enabled: value });
            await this.plugin.saveSettings();
            for (const view of this.plugin.getAllViews()) {
              view.refreshModelSelector();
            }
          })
      );

    new Setting(container)
      .setName('Global environment variables')
      .setDesc('Extra global environment variables passed to Pi agent.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter environment variables (e.g. Key=value)...')
          .setValue(piSettings.environmentVariables)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { environmentVariables: value });
            await this.plugin.saveSettings();
          })
      );

    // AI Providers and Credentials
    new Setting(container).setName('AI model providers').setHeading();
    const providersDesc = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
    providersDesc.createEl('p', {
      text: 'Configure API keys or OAUTH authentication for the LLM providers supported by the Pi agent, and select candidate models for your selection pool.',
    });

    // Populate all available providers from models cache + standard list
    const allProvidersSet = new Set<string>();
    for (const model of PI_AI_MODELS_CACHE.values()) {
      if (model.provider) {
        allProvidersSet.add(model.provider);
      }
    }
    // Fallback when cache hasn't loaded (shouldn't happen since warm is awaited)
    if (allProvidersSet.size === 0) {
      const knownProviders = [
        'amazon-bedrock','anthropic','azure-openai-responses','cerebras',
        'cloudflare-ai-gateway','cloudflare-workers-ai','deepseek',
        'fireworks','github-copilot','google','google-vertex','groq',
        'huggingface','kimi-coding','minimax','minimax-cn','mistral',
        'moonshotai','moonshotai-cn','openai','openai-codex',
        'opencode','opencode-go','openrouter','together',
        'vercel-ai-gateway','xai','xiaomi','xiaomi-token-plan-ams',
        'xiaomi-token-plan-cn','xiaomi-token-plan-sgp','zai',
      ];
      for (const p of knownProviders) {
        allProvidersSet.add(p);
      }
    }
    const allAvailableProviders = Array.from(allProvidersSet).sort();
    const providersNotAdded = allAvailableProviders.filter(p => !piSettings.addedProviders.includes(p));

    let selectedProviderToAdd = '';

    // Add Provider Control Row
    const addProviderSetting = new Setting(container)
      .setName('Add AI provider')
      .setDesc('Select an LLM provider supported by Pi to configure and add its models.');

    addProviderSetting.addDropdown((dropdown) => {
      dropdown.addOption('', 'Select provider...');
      for (const prov of providersNotAdded) {
        dropdown.addOption(prov, getProviderDisplayName(prov));
      }
      dropdown.onChange((val) => {
        selectedProviderToAdd = val;
      });
    });

    addProviderSetting.addButton((btn) => {
      btn.setButtonText('+ add')
        .setCta()
        .onClick(async () => {
          if (!selectedProviderToAdd) {
            new Notice('Please select a provider to add.');
            return;
          }
          const added = [...piSettings.addedProviders, selectedProviderToAdd];
          updatePiProviderSettings(settingsBag, { addedProviders: added });
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Added ${getProviderDisplayName(selectedProviderToAdd)} provider.`);
        });
    });

    const providersContainer = container.createDiv({ cls: 'obsius2-providers-list' });

    for (const providerId of piSettings.addedProviders) {
      const info = getProviderEnvVars(providerId);
      const displayName = getProviderDisplayName(providerId);

      const card = providersContainer.createEl('details', { cls: 'obsius2-provider-card' });
      const summary = card.createEl('summary', { cls: 'obsius2-provider-header' });

      // Title
      summary.createSpan({ cls: 'obsius2-provider-title', text: displayName });
      
      const apiKeyVal = getEnvVarValue(piSettings.environmentVariables, info.apiKeyVar);
      const oauthVal = info.oauthVar ? getEnvVarValue(piSettings.environmentVariables, info.oauthVar) : '';
      const isConfigured = !!(apiKeyVal || oauthVal);

      const statusBadge = summary.createSpan({
        cls: `obsius2-provider-status ${isConfigured ? 'configured' : 'not-configured'}`,
        text: isConfigured ? 'Configured' : 'Not Configured'
      });

      // Remove button next to the status badge
      const removeBtn = summary.createEl('button', {
        cls: 'obsius2-provider-remove-btn',
        text: 'Remove'
      });
      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const added = piSettings.addedProviders.filter(p => p !== providerId);
        const visible = piSettings.visibleModels.filter(m => !m.startsWith(`${providerId}/`));
        
        updatePiProviderSettings(settingsBag, { addedProviders: added, visibleModels: visible });
        await this.plugin.saveSettings();
        this.display();
        new Notice(`Removed ${displayName} provider.`);
      });

      const body = card.createDiv({ cls: 'obsius2-provider-body' });

      // Credentials Input section
      new Setting(body).setName("Authentication & credentials").setHeading();
      
      let activeAuthType: 'api' | 'oauth' = oauthVal ? 'oauth' : 'api';

      const authToggleWrapper = body.createDiv({ cls: 'obsius2-auth-toggle-wrapper obsius2-hidden' });
      if (info.oauthVar) {
        authToggleWrapper.removeClass('obsius2-hidden');
        const apiBtn = authToggleWrapper.createEl('button', {
          cls: `obsius2-auth-toggle-btn ${activeAuthType === 'api' ? 'active' : ''}`,
          text: 'API key'
        });
        const oauthBtn = authToggleWrapper.createEl('button', {
          cls: `obsius2-auth-toggle-btn ${activeAuthType === 'oauth' ? 'active' : ''}`,
          text: 'OAUTH token'
        });

        apiBtn.addEventListener('click', (e) => {
          e.preventDefault();
          activeAuthType = 'api';
          apiBtn.addClass('active');
          oauthBtn.removeClass('active');
          apiInputRow.removeClass('obsius2-hidden');
          oauthInputRow.addClass('obsius2-hidden');
        });

        oauthBtn.addEventListener('click', (e) => {
          e.preventDefault();
          activeAuthType = 'oauth';
          oauthBtn.addClass('active');
          apiBtn.removeClass('active');
          oauthInputRow.removeClass('obsius2-hidden');
          apiInputRow.addClass('obsius2-hidden');
        });
      }

      // API Key input row
      const apiInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'oauth' ? 'obsius2-hidden' : ''}` });
      new Setting(apiInputRow)
        .setName('API key')
        .setDesc(`Enter your ${displayName} API Key.`)
        .addText((text) => {
          text
            .setPlaceholder('Enter API key...')
            .setValue(apiKeyVal)
            .onChange(async (val) => {
              const updatedEnv = setEnvVarValue(piSettings.environmentVariables, info.apiKeyVar, val);
              updatePiProviderSettings(settingsBag, { environmentVariables: updatedEnv });
              await this.plugin.saveSettings();
              
              const freshApiKey = getEnvVarValue(updatedEnv, info.apiKeyVar);
              const freshOauth = info.oauthVar ? getEnvVarValue(updatedEnv, info.oauthVar) : '';
              const freshConfigured = !!(freshApiKey || freshOauth);
              statusBadge.setText(freshConfigured ? 'Configured' : 'Not Configured');
              statusBadge.className = `obsius2-provider-status ${freshConfigured ? 'configured' : 'not-configured'}`;
            });
          text.inputEl.type = 'password';
        });

      // OAuth input row
      const oauthInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'api' ? 'obsius2-hidden' : ''}` });
      if (info.oauthVar) {
        new Setting(oauthInputRow)
          .setName('OAUTH token')
          .setDesc('Paste your OAUTH token or authorize your account.')
          .addText((text) => {
            text
              .setPlaceholder('Enter OAUTH token...')
              .setValue(oauthVal)
              .onChange(async (val) => {
                const updatedEnv = setEnvVarValue(piSettings.environmentVariables, info.oauthVar!, val);
                updatePiProviderSettings(settingsBag, { environmentVariables: updatedEnv });
                await this.plugin.saveSettings();

                const freshApiKey = getEnvVarValue(updatedEnv, info.apiKeyVar);
                const freshOauth = getEnvVarValue(updatedEnv, info.oauthVar!);
                const freshConfigured = !!(freshApiKey || freshOauth);
                statusBadge.setText(freshConfigured ? 'Configured' : 'Not Configured');
                statusBadge.className = `obsius2-provider-status ${freshConfigured ? 'configured' : 'not-configured'}`;
              });
            text.inputEl.type = 'password';
          });
      }

      // Models checklists section
      new Setting(body).setName("Candidate models pool").setHeading();
      const modelsGrid = body.createDiv({ cls: 'obsius2-models-checklist-grid' });

      const providerModels = getPiAiModelsForProvider(providerId);
      for (const model of providerModels) {
        const isChecked = piSettings.visibleModels.includes(model.value);

        const checkboxWrapper = modelsGrid.createDiv({ cls: 'obsius2-model-checkbox-wrapper' });
        const checkbox = checkboxWrapper.createEl('input', {
          type: 'checkbox',
          cls: 'obsius2-model-checkbox',
          attr: { id: `checkbox-${model.value.replace(/\//g, '-')}` }
        });
        checkbox.checked = isChecked;

        const label = checkboxWrapper.createEl('label', {
          cls: 'obsius2-model-checkbox-label',
          attr: { for: `checkbox-${model.value.replace(/\//g, '-')}` }
        });
        label.createSpan({ cls: 'obsius2-model-checkbox-title', text: model.label });
        label.createSpan({ cls: 'obsius2-model-checkbox-desc', text: model.description });

        checkbox.addEventListener('change', async () => {
          let visible = [...piSettings.visibleModels];
          if (checkbox.checked) {
            if (!visible.includes(model.value)) {
              visible.push(model.value);
            }
          } else {
            visible = visible.filter(v => v !== model.value);
          }

          updatePiProviderSettings(settingsBag, { visibleModels: visible });
          await this.plugin.saveSettings();
          
          for (const view of this.plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        });
      }

      if (providerModels.length === 0) {
        modelsGrid.createDiv({ cls: 'obsius2-no-models-message', text: 'No predefined models loaded for this provider yet.' });
      }
    }
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProviderCommands = {
              ...this.plugin.settings.hiddenProviderCommands,
              [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
            };
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId
      ? [providerId]
      : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
      );
      for (const modelId of ProviderRegistry.getChatUIConfig(targetProviderId).getCustomModelIds(envVars)) {
        uniqueModelIds.add(modelId);
      }
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
      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
