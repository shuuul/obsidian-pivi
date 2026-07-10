import {
  getObsidianToolsSettingsFromBag,
} from '@pivi/pivi-agent-core/foundation/settings';

/**
 * Pinned external context roots for a new session. Availability is deliberately
 * checked per turn so a temporarily disconnected path keeps its pin.
 */
export function getDefaultExternalContextPaths(
  settings: Record<string, unknown>,
): string[] {
  return [...getObsidianToolsSettingsFromBag(settings).externalReadDirectories];
}
