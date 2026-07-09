import {
  getSubagentRuntimeSettingsFromBag,
  resolveSubagentRuntimeSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Setting } from 'obsidian';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { t } from '@/i18n';

export interface SubagentSettingsSectionOptions {
  container: HTMLElement;
  plugin: PiviSettingsHost;
  restartServiceForPromptChange: () => Promise<void>;
}

export function renderSubagentSettingsSection(options: SubagentSettingsSectionOptions): void {
  const { container, plugin, restartServiceForPromptChange } = options;
  new Setting(container).setName(t('settings.subagents.heading')).setHeading();
  const current = getSubagentRuntimeSettingsFromBag(plugin.settings);

  const saveSubagentSettings = async (updates: Partial<typeof current>): Promise<void> => {
    const latest = getSubagentRuntimeSettingsFromBag(plugin.settings);
    plugin.settings.agentSettings.subagents = resolveSubagentRuntimeSettings({
      ...latest,
      ...updates,
    });
    try {
      await plugin.saveSettings();
      await restartServiceForPromptChange();
    } catch (error) {
      console.error('Failed to save subagent settings', error);
    }
  };

  new Setting(container)
    .setName(t('settings.subagents.enableSpawn.name'))
    .setDesc(t('settings.subagents.enableSpawn.desc'))
    .addToggle((toggle) => {
      toggle
        .setValue(current.enabled)
        .onChange((value) => saveSubagentSettings({ enabled: value }));
    });

  new Setting(container)
    .setName(t('settings.subagents.allowBackground.name'))
    .setDesc(t('settings.subagents.allowBackground.desc'))
    .addToggle((toggle) => {
      toggle
        .setValue(current.allowBackground)
        .onChange((value) => saveSubagentSettings({ allowBackground: value }));
    });

  new Setting(container)
    .setName(t('settings.subagents.maxConcurrent.name'))
    .setDesc(t('settings.subagents.maxConcurrent.desc'))
    .addDropdown((dropdown) => {
      for (const value of [1, 2, 3, 4, 8]) {
        dropdown.addOption(String(value), `${value}`);
      }
      dropdown
        .setValue(String(current.maxConcurrentSubagents))
        .onChange((value) => saveSubagentSettings({ maxConcurrentSubagents: Number(value) }));
    });
}
