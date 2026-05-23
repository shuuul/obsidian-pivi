import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { getPiProviderSettings, updatePiProviderSettings } from '../settings';

export const piSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const piSettings = getPiProviderSettings(settingsBag);

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Pi coding agent')
      .setDesc('Launch `pi --mode rpc` as a provider.')
      .addToggle((toggle) =>
        toggle
          .setValue(piSettings.enabled)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    new Setting(container)
      .setName('Environment variables')
      .setDesc('Extra environment variables passed to Pi.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Pi_enable_exa=1')
          .setValue(piSettings.environmentVariables)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { environmentVariables: value });
            await context.plugin.saveSettings();
          })
      );
  },
};
