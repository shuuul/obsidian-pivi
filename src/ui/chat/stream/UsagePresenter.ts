import { PiSettingsCoordinator } from '@pivi/pivi-agent-core/engine/pi/PiSettingsCoordinator';
import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/PiChatService';

import type PiviPlugin from '@/app/PiviPluginHost';

import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';

/** Whether a usage stream chunk should update tab usage state. */
export function shouldApplyUsageStreamChunk(params: {
  chunkSessionId: string | null | undefined;
  currentSessionId: string | null;
  subagentsSpawnedThisStream: number;
  ignoreUsageUpdates: boolean;
}): boolean {
  const { chunkSessionId, currentSessionId, subagentsSpawnedThisStream, ignoreUsageUpdates } = params;

  if (ignoreUsageUpdates) {
    return false;
  }

  // Pi may report cumulative usage while subagents ran; skip until stream ends.
  if (subagentsSpawnedThisStream > 0) {
    return false;
  }

  if (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) {
    return false;
  }

  if (chunkSessionId && !currentSessionId) {
    return false;
  }

  return true;
}

/** Resolve the active model key from plugin settings when a runtime is bound. */
export function resolveActiveChatModel(
  plugin: PiviPlugin,
  getAgentService?: () => PiChatService | null,
): string | undefined {
  if (!getAgentService?.()) {
    return undefined;
  }

  const settings = PiSettingsCoordinator.getSettingsSnapshot(plugin.settings);
  return typeof settings.model === 'string' ? settings.model : undefined;
}

export interface UsagePresenterDeps {
  plugin: PiviPlugin;
  state: ChatState;
  subagentManager: SubagentManager;
  getAgentService?: () => PiChatService | null;
}

export class UsagePresenter {
  constructor(private readonly deps: UsagePresenterDeps) {}

  handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    const { state } = this.deps;
    const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
    if (!shouldApplyUsageStreamChunk({
      chunkSessionId: chunk.sessionId ?? null,
      currentSessionId,
      subagentsSpawnedThisStream: this.deps.subagentManager.subagentsSpawnedThisStream,
      ignoreUsageUpdates: state.ignoreUsageUpdates,
    })) {
      return;
    }
    const activeModel = resolveActiveChatModel(this.deps.plugin, this.deps.getAgentService);
    state.usage = activeModel && !chunk.usage.model
      ? { ...chunk.usage, model: activeModel }
      : chunk.usage;
  }
}
