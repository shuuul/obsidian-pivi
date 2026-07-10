import type { CustomProviderConfig } from '@pivi/pivi-agent-core/foundation/customProviders';
import { Notice, Setting } from 'obsidian';

import { t } from '@/i18n';

import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderCustomProviderPanel(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  config: CustomProviderConfig,
): void {
  new Setting(body).setName(t('settings.modelsTab.endpointHeading')).setHeading();

  new Setting(body)
    .setName(t('settings.modelsTab.displayName'))
    .setDesc(t('settings.modelsTab.displayNameDesc'))
    .addText((text) => {
      text.setValue(config.name).onChange((value) => {
        void persistCustomProviderPatch(context, state, config.id, {
          name: value.trim() || config.name,
        });
      });
    });

  new Setting(body)
    .setName(t('settings.modelsTab.baseUrl'))
    .setDesc(t('settings.modelsTab.baseUrlDesc'))
    .addText((text) => {
      text
        .setPlaceholder(t('settings.modelsTab.baseUrlPlaceholder'))
        .setValue(config.baseUrl)
        .onChange((value) => {
          void persistCustomProviderPatch(context, state, config.id, {
            baseUrl: value.trim(),
          });
        });
    });

  const fetchRow = body.createDiv({ cls: 'pivi-custom-provider-actions' });
  const fetchButton = fetchRow.createEl('button', {
    cls: 'pivi-provider-fetch-models-btn',
    text: t('settings.modelsTab.fetchModels'),
    type: 'button',
  });

  fetchButton.addEventListener('click', () => {
    void (async () => {
      fetchButton.disabled = true;
      const previous = fetchButton.textContent ?? t('settings.modelsTab.fetchModels');
      fetchButton.setText(t('settings.modelsTab.fetchingModels'));
      try {
        const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
        // Persist latest panel values from state before fetch.
        context.plugin.getUiFacades().syncCustomProviders(settingsBag);
        const result = await context.plugin.getUiFacades().fetchCustomProviderModels(
          config.id,
          settingsBag,
        );
        await context.plugin.saveSettings();
        context.redisplay();
        for (const view of context.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
        new Notice(t('settings.modelsTab.fetchModelsSuccess', {
          name: config.name,
          count: String(result.count),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(t('settings.modelsTab.fetchModelsFailed', {
          name: config.name,
          message,
        }), 0);
      } finally {
        fetchButton.disabled = false;
        fetchButton.setText(previous);
      }
    })();
  });
}

async function persistCustomProviderPatch(
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providerId: string,
  patch: Partial<Pick<CustomProviderConfig, 'name' | 'baseUrl'>>,
): Promise<void> {
  const customProviders = state.piSettings.customProviders.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          ...patch,
        }
      : provider,
  );
  state.updatePiSettings({ customProviders });
  context.plugin.getUiFacades().syncCustomProviders(
    context.plugin.settings,
  );
  await context.plugin.saveSettings();
}
