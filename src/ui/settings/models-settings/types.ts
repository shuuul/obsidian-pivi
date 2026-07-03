import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import type { PiAgentSettingsView } from '@pivi/pivi-agent-core/foundation/settingsModelKey';

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
