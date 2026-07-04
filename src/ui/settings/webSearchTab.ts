import { credentialToApiKey } from "@pivi/pivi-agent-core/auth/piProviderCredentials";
import {
  resolveWebSearchToolsSettings,
  WEB_FETCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDER_IDS,
  type WebFetchProviderChoice,
  type WebSearchProviderChoice,
  type WebSearchProviderId,
  type WebSearchToolsSettings,
} from "@pivi/pivi-agent-core/foundation/settings";
import { Setting } from "obsidian";

import type { PiviPluginHost as PiviPlugin } from "@/app/PiviPluginHost";

import type { PiviSettingsTabRenderContext } from "./piviSettingsTabs";

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
  const credentialStore = ctx.plugin.getPiWorkspace()?.credentialStore ?? null;
  const hasKey = Boolean(credentialToApiKey(credentialStore?.readSync(providerId)));

  new Setting(container)
    .setName(`${WEB_SEARCH_PROVIDER_LABELS[providerId]} API key`)
    .setDesc(`Saved in Obsidian keychain. Used when provider is ${providerId} or auto.`)
    .addText((text) => {
      text
        .setDisabled(!credentialStore)
        .setPlaceholder(hasKey ? 'Saved in keychain' : 'Enter API key...')
        .onChange(async (val) => {
          if (val === MASKED_WEB_SEARCH_KEY || !credentialStore) {
            return;
          }
          if (!val.trim()) {
            return;
          }
          await credentialStore.modify(providerId, () =>
            Promise.resolve({ type: 'api_key' as const, key: val.trim() }),
          );
          text.inputEl.value = MASKED_WEB_SEARCH_KEY;
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
      btn
        .setButtonText('Remove')
        .setDisabled(!credentialStore || !hasKey)
        .onClick(() => {
          void (async () => {
            await credentialStore?.delete(providerId);
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
    text: createFragment((frag) => {
      frag.appendText("Configure web tools. WebSearch can use Brave, Tavily, or Exa; WebFetch can use Tavily or Exa, with direct HTTP fallback.");
    }),
  });

  const settings = getWebSearchSettings(ctx.plugin);

  new Setting(container)
    .setName("Preferred search provider")
    .setDesc(createFragment((frag) => {
      frag.appendText("Used by WebSearch. Pivi tries this first, then falls back to other configured search providers and Exa public MCP.");
    }))
    .addDropdown((dropdown) => {
      dropdown.addOption('auto', 'Auto (any configured search provider)');
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
    .setName("Preferred fetch provider")
    .setDesc(createFragment((frag) => {
      frag.appendText("Used by WebFetch. Pivi tries this first, then falls back to other configured fetch-capable providers and direct HTTP.");
    }))
    .addDropdown((dropdown) => {
      dropdown.addOption('auto', 'Auto (any configured fetch provider)');
      for (const providerId of WEB_FETCH_PROVIDER_IDS) {
        dropdown.addOption(providerId, WEB_SEARCH_PROVIDER_LABELS[providerId]);
      }
      dropdown
        .setValue(settings.fetchProvider)
        .onChange(async (value) => {
          await saveWebProviderSettings(ctx, { fetchProvider: value as WebFetchProviderChoice });
        });
    });

  new Setting(container).setName("API keys").setHeading();

  for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
    renderProviderApiKeyRow(container, ctx, providerId);
  }
}