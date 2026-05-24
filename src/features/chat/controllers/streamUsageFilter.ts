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
