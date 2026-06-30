import { AgentSettingsCoordinator } from '../../../core/agent/AgentSettingsCoordinator';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type PiviPlugin from '../../../main';

/** Resolve the active model key from plugin settings when a runtime is bound. */
export function resolveActiveChatModel(
  plugin: PiviPlugin,
  getAgentService?: () => ChatRuntime | null,
): string | undefined {
  if (!getAgentService?.()) {
    return undefined;
  }

  const settings = AgentSettingsCoordinator.getAgentSettingsSnapshot(plugin.settings);
  return typeof settings.model === 'string' ? settings.model : undefined;
}
