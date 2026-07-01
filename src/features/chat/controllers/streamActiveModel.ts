import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type PiviPlugin from '../../../main';
import { PiSettingsCoordinator } from '../../../pi/PiSettingsCoordinator';

/** Resolve the active model key from plugin settings when a runtime is bound. */
export function resolveActiveChatModel(
  plugin: PiviPlugin,
  getAgentService?: () => ChatRuntime | null,
): string | undefined {
  if (!getAgentService?.()) {
    return undefined;
  }

  const settings = PiSettingsCoordinator.getSettingsSnapshot(plugin.settings);
  return typeof settings.model === 'string' ? settings.model : undefined;
}
