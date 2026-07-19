import type { StreamChunk } from '../../foundation';
import { StreamChunkQueue } from '../../runtime/streamChunkQueue';
import type { PreparedChatTurn } from '../../runtime/types';
import { TOOL_SPAWN_AGENT } from '../../tools';

export interface ActiveTurn {
  queue: StreamChunkQueue;
  abortController: AbortController;
  acceptingSubagentChunks: boolean;
  subagentToolIds: Set<string>;
  steeredTurns: PreparedChatTurn[];
  persistedSteeredTurnCount: number;
}

export function createActiveTurn(): ActiveTurn {
  return {
    queue: new StreamChunkQueue(),
    abortController: new AbortController(),
    acceptingSubagentChunks: true,
    subagentToolIds: new Set<string>(),
    steeredTurns: [],
    persistedSteeredTurnCount: 0,
  };
}

export function closeActiveTurnQueue(activeTurn: ActiveTurn): void {
  activeTurn.abortController.abort();
  activeTurn.acceptingSubagentChunks = false;
  activeTurn.queue.close();
}

export function finishActiveTurnQueue(activeTurn: ActiveTurn): void {
  activeTurn.acceptingSubagentChunks = false;
  activeTurn.queue.push({ type: 'done' });
  activeTurn.queue.close();
}

export function trackActiveTurnSubagentTool(activeTurn: ActiveTurn, chunk: StreamChunk): void {
  if (chunk.type === 'tool_use' && chunk.name === TOOL_SPAWN_AGENT) {
    activeTurn.subagentToolIds.add(chunk.id);
  }
}

export function getSubagentOwnerToolId(chunk: StreamChunk): string | null {
  return 'subagentId' in chunk && typeof chunk.subagentId === 'string'
    ? chunk.subagentId
    : null;
}
