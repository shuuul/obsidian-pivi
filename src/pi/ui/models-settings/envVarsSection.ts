import { Setting } from 'obsidian';

import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderPiAgentSetupSection(
  container: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
): void {
  new Setting(container).setName('Pi agent setup').setHeading();

  new Setting(container)
    .setName('Global environment variables')
    .setDesc('Extra global environment variables passed to the in-process Pi agent.')
    .addTextArea((text) =>
      text
        .setPlaceholder('Enter environment variables (e.g. Key=value)...')
        .setValue(state.piSettings.environmentVariables)
        .onChange(async (value) => {
          state.updatePiSettings({ environmentVariables: value });
          await context.plugin.saveSettings();
        }),
    );
}
