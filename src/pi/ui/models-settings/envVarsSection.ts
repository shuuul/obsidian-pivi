import { Notice, Setting } from 'obsidian';

import { AgentServices } from '../../../core/agent/AgentServices';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderPiAgentSetupSection(
  container: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
): void {
  new Setting(container).setName('Pi agent setup').setHeading();

  new Setting(container)
    .setName('Test connection')
    .setDesc('Check whether the configured model API endpoint is reachable from this device.')
    .addButton((btn) => {
      btn.setButtonText('Test connection');
      btn.onClick(async () => {
        btn.setDisabled(true);
        const previousLabel = btn.buttonEl.textContent ?? 'Test connection';
        btn.setButtonText('Testing…');
        try {
          const runtime = AgentServices.createChatRuntime({ plugin: context.plugin });
          if (!runtime.testConnectivity) {
            new Notice('Connectivity test is not available for this agent.');
            return;
          }
          const result = await runtime.testConnectivity();
          new Notice(
            result.ok ? `Connection OK: ${result.detail}` : `Connection failed: ${result.detail}`,
            result.ok ? 8000 : 0,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Connection test error: ${message}`);
        } finally {
          btn.setDisabled(false);
          btn.setButtonText(previousLabel);
        }
      });
    });

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
