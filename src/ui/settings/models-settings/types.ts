import type { PiAgentSettingsView } from '@pivi/pi-runtime/settings/agentSettings';
import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/pi-runtime/settings/agentSettings';

import type PiviPlugin from '@/app/PiviPluginHost';

export interface PiModelsSettingsContext {
  plugin: PiviPlugin;
  redisplay: () => void;
  onEnvironmentChanged?: () => void;
}

export interface PiModelsSettingsState {
  settingsBag: Record<string, unknown>;
  readonly piSettings: PiAgentSettingsView;
  updatePiSettings: (
    patch: Parameters<typeof updatePiAgentSettings>[1],
  ) => PiAgentSettingsView;
}

export function createPiModelsSettingsState(
  settingsBag: Record<string, unknown>,
  initialPiSettings?: PiAgentSettingsView,
): PiModelsSettingsState {
  let piSettings = initialPiSettings ?? getPiAgentSettings(settingsBag);

  return {
    settingsBag,
    get piSettings() {
      return piSettings;
    },
    updatePiSettings(patch) {
      piSettings = updatePiAgentSettings(settingsBag, patch);
      return piSettings;
    },
  };
}
