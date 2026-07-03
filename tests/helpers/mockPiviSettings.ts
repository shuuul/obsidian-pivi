import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation/settings';

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
    keyboardNavigation: {
      ...DEFAULT_PIVI_SETTINGS.keyboardNavigation,
      ...overrides.keyboardNavigation,
    },
  };
}
