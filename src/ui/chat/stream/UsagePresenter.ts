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
  followsCompaction?: boolean;
}): boolean {
  const {
    chunkSessionId,
    currentSessionId,
    subagentsSpawnedThisStream,
    ignoreUsageUpdates,
    followsCompaction = false,
  } = params;

  if (ignoreUsageUpdates) {
    return false;
  }

  // Pi may report cumulative usage while subagents ran; skip until stream ends.
  if (subagentsSpawnedThisStream > 0 && !followsCompaction) {
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
  private nextUsageFollowsCompaction = false;

  constructor(private readonly deps: UsagePresenterDeps) {}

  markCompactionApplied(): void {
    this.nextUsageFollowsCompaction = true;
  }

  handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    const { state } = this.deps;
    const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
    const followsCompaction = this.nextUsageFollowsCompaction;
    this.nextUsageFollowsCompaction = false;
    if (!shouldApplyUsageStreamChunk({
      chunkSessionId: chunk.sessionId ?? null,
      currentSessionId,
      subagentsSpawnedThisStream: this.deps.subagentManager.subagentsSpawnedThisStream,
      ignoreUsageUpdates: state.ignoreUsageUpdates,
      followsCompaction,
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
