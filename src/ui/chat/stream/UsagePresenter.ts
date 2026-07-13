import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';

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
  settings: ChatSettingsPort,
  getAgentService?: () => PiChatService | null,
): string | undefined {
  if (!getAgentService?.()) {
    return undefined;
  }

  return settings.getSettingsSnapshot().model;
}

export interface UsagePresenterDeps {
  settings: ChatSettingsPort;
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
    const activeModel = resolveActiveChatModel(
      this.deps.settings,
      this.deps.getAgentService,
    );
    state.usage = activeModel && !chunk.usage.model
      ? { ...chunk.usage, model: activeModel }
      : chunk.usage;
  }
}
