import {
  resolveWebSearchToolsSettings,
  WEB_FETCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDER_IDS,
  type WebFetchProviderChoice,
  type WebSearchProviderChoice,
  type WebSearchProviderId,
  type WebSearchToolsSettings,
} from "@pivi/pivi-agent-core/foundation/settings";
import {
  type ButtonComponent,
  Setting,
} from "obsidian";

import type { PiviPluginHost as PiviPlugin } from "@/app/PiviPluginHost";
import { t } from "@/i18n";

import type { PiviSettingsTabRenderContext } from "./piviSettingsTabs";

/** Brand names stay untranslated. */
const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProviderId, string> = {
  brave: 'Brave Search',
  tavily: 'Tavily',
  exa: 'Exa',
};

const MASKED_WEB_SEARCH_KEY = '••••••••';

function getWebSearchSettings(plugin: PiviPlugin) {
  return resolveWebSearchToolsSettings(plugin.settings.agentSettings?.webSearchTools);
}

async function saveWebProviderSettings(
  ctx: PiviSettingsTabRenderContext,
  patch: Partial<Pick<WebSearchToolsSettings, 'searchProvider' | 'fetchProvider'>>,
): Promise<void> {
  const settings = resolveWebSearchToolsSettings(ctx.plugin.settings.agentSettings?.webSearchTools);
  ctx.plugin.settings.agentSettings = {
    ...ctx.plugin.settings.agentSettings,
    webSearchTools: { ...settings, ...patch },
  };
  await ctx.plugin.saveSettings();
  await ctx.restartServiceForPromptChange();
}

function renderProviderApiKeyRow(
  container: HTMLElement,
  ctx: PiviSettingsTabRenderContext,
  providerId: WebSearchProviderId,
): void {
  const credentialStore = ctx.plugin.getPiWorkspace()?.webSearchCredentialStore ?? null;
  const hasKey = Boolean(credentialStore?.readSync(providerId));
  let removeButton: ButtonComponent | null = null;

  const updateRemoveButton = (hasSavedKey: boolean): void => {
    removeButton?.setDisabled(!credentialStore || !hasSavedKey);
  };

  new Setting(container)
    .setName(t('settings.webSearch.apiKeyName', {
      provider: WEB_SEARCH_PROVIDER_LABELS[providerId],
    }))
    .setDesc(t('settings.webSearch.apiKeyDesc', { provider: providerId }))
    .addText((text) => {
      text
        .setDisabled(!credentialStore)
        .setPlaceholder(
          hasKey
            ? t('settings.webSearch.apiKeySavedPlaceholder')
            : t('settings.webSearch.apiKeyPlaceholder'),
        )
        .onChange(async (val) => {
          if (val === MASKED_WEB_SEARCH_KEY || !credentialStore) {
            return;
          }
          if (!val.trim()) {
            return;
          }
          credentialStore.writeSync(providerId, val);
          text.inputEl.value = MASKED_WEB_SEARCH_KEY;
          updateRemoveButton(true);
          await ctx.restartServiceForPromptChange();
        });
      text.inputEl.value = hasKey ? MASKED_WEB_SEARCH_KEY : '';
      text.inputEl.addEventListener('focus', () => {
        if (text.inputEl.value === MASKED_WEB_SEARCH_KEY) {
          text.inputEl.value = '';
        }
      });
    })
    .addButton((btn) => {
      removeButton = btn;
      btn
        .setButtonText(t('settings.webSearch.removeKey'))
        .setDisabled(!credentialStore || !hasKey)
        .onClick(() => {
          void (async () => {
            credentialStore?.clearSync(providerId);
            await ctx.restartServiceForPromptChange();
            ctx.redisplay();
          })();
        });
    });
}

export function renderWebSearchTab(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const desc = container.createDiv({ cls: "pivi-sp-settings-desc" });
  desc.createEl("p", {
    cls: "setting-item-description",
    text: t('settings.webSearch.intro'),
  });

  const settings = getWebSearchSettings(ctx.plugin);

  new Setting(container)
    .setName(t('settings.webSearch.preferredSearch.name'))
    .setDesc(t('settings.webSearch.preferredSearch.desc'))
    .addDropdown((dropdown) => {
      dropdown.addOption('auto', t('settings.webSearch.autoSearchOption'));
      for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
        dropdown.addOption(providerId, WEB_SEARCH_PROVIDER_LABELS[providerId]);
      }
      dropdown
        .setValue(settings.searchProvider)
        .onChange(async (value) => {
          await saveWebProviderSettings(ctx, { searchProvider: value as WebSearchProviderChoice });
        });
    });

  new Setting(container)
    .setName(t('settings.webSearch.preferredFetch.name'))
    .setDesc(t('settings.webSearch.preferredFetch.desc'))
    .addDropdown((dropdown) => {
      dropdown.addOption('auto', t('settings.webSearch.autoFetchOption'));
      for (const providerId of WEB_FETCH_PROVIDER_IDS) {
        dropdown.addOption(providerId, WEB_SEARCH_PROVIDER_LABELS[providerId]);
      }
      dropdown
        .setValue(settings.fetchProvider)
        .onChange(async (value) => {
          await saveWebProviderSettings(ctx, { fetchProvider: value as WebFetchProviderChoice });
        });
    });

  new Setting(container).setName(t('settings.webSearch.apiKeysHeading')).setHeading();

  for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
    renderProviderApiKeyRow(container, ctx, providerId);
  }
}
