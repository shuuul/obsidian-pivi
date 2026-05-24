import { DEFAULT_OBSIUS_SETTINGS } from '../../src/app/settings/defaultSettings';
import type { ObsiusSettings } from '../../src/core/types/settings';

/** Default Obsius settings with optional overrides for tests. */
export function createMockObsiusSettings(
  overrides: Partial<ObsiusSettings> = {},
): ObsiusSettings {
  return {
    ...DEFAULT_OBSIUS_SETTINGS,
    ...overrides,
    agentSettings: {
      ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
      ...overrides.agentSettings,
    },
    keyboardNavigation: {
      ...DEFAULT_OBSIUS_SETTINGS.keyboardNavigation,
      ...overrides.keyboardNavigation,
    },
  };
}
