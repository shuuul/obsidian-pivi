import type { SecretStorage } from 'obsidian';

import type PiviPlugin from '../../../main';
import type { PiAgentSettingsView } from '../../settings';
import { getPiAgentSettings, updatePiAgentSettings } from '../../settings';

export interface PiModelsSettingsContext {
  plugin: PiviPlugin;
  redisplay: () => void;
}

export interface PiModelsSettingsState {
  settingsBag: Record<string, unknown>;
  secretStorage: SecretStorage;
  readonly piSettings: PiAgentSettingsView;
  updatePiSettings: (
    patch: Parameters<typeof updatePiAgentSettings>[1],
  ) => PiAgentSettingsView;
}

export function createPiModelsSettingsState(
  settingsBag: Record<string, unknown>,
  secretStorage: SecretStorage,
  initialPiSettings?: PiAgentSettingsView,
): PiModelsSettingsState {
  let piSettings = initialPiSettings ?? getPiAgentSettings(settingsBag);

  return {
    settingsBag,
    secretStorage,
    get piSettings() {
      return piSettings;
    },
    updatePiSettings(patch) {
      piSettings = updatePiAgentSettings(settingsBag, patch);
      return piSettings;
    },
  };
}
