import {
  getSubagentRuntimeSettingsFromBag,
  resolveSubagentRuntimeSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Setting } from 'obsidian';

import type { PiviPluginHost as PiviPlugin } from '@/app/PiviPluginHost';

export interface SubagentSettingsSectionOptions {
  container: HTMLElement;
  plugin: PiviPlugin;
  restartServiceForPromptChange: () => Promise<void>;
}

export function renderSubagentSettingsSection(options: SubagentSettingsSectionOptions): void {
  const { container, plugin, restartServiceForPromptChange } = options;
  new Setting(container).setName('Subagents').setHeading();
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
    .setName('Enable spawn_agent')
    .setDesc('Expose the spawn_agent tool so Pi can delegate focused subtasks to subagents.')
    .addToggle((toggle) => {
      toggle
        .setValue(current.enabled)
        .onChange((value) => saveSubagentSettings({ enabled: value }));
    });

  new Setting(container)
    .setName('Allow background subagents')
    .setDesc('Allow spawn_agent calls with run_in_background=true. Completed results hydrate back into the subagent card.')
    .addToggle((toggle) => {
      toggle
        .setValue(current.allowBackground)
        .onChange((value) => saveSubagentSettings({ allowBackground: value }));
    });

  new Setting(container)
    .setName('Max simultaneous subagents')
    .setDesc('Hard limit for concurrently running background subagents. Each spawn_agent call gets an isolated worker to avoid context cross-contamination.')
    .addDropdown((dropdown) => {
      for (const value of [1, 2, 3, 4, 8]) {
        dropdown.addOption(String(value), `${value}`);
      }
      dropdown
        .setValue(String(current.maxConcurrentSubagents))
        .onChange((value) => saveSubagentSettings({ maxConcurrentSubagents: Number(value) }));
    });
}
