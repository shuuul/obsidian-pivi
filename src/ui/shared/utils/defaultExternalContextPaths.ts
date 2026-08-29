import {
  getObsidianToolsSettingsFromBag,
} from '@pivi/agent/settings/types';

/**
 * Pinned external context roots for a new session. Availability is deliberately
 * checked per turn so a temporarily disconnected path keeps its pin.
 */
export function getDefaultExternalContextPaths(
  settings: Record<string, unknown>,
): string[] {
  return [...getObsidianToolsSettingsFromBag(settings).externalReadDirectories];
}
