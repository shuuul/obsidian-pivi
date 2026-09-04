import { DEFAULT_PIVI_SETTINGS } from '@pivi/agent/settings/defaults';
import type { PiviSettings } from '@pivi/agent/settings/types';

/** Default Pivi settings with optional overrides for tests. */
export function createMockPiviSettings(
  overrides: Partial<PiviSettings> = {},
): PiviSettings {
  return {
    ...DEFAULT_PIVI_SETTINGS,
    ...overrides,
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      ...overrides.agentSettings,
    },
  };
}
