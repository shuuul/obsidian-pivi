import type { StreamChunk } from '../../foundation';
import { StreamChunkQueue } from '../../runtime/streamChunkQueue';
import { TOOL_SPAWN_AGENT } from '../../tools';

export interface ActiveTurn {
  queue: StreamChunkQueue;
  acceptingSubagentChunks: boolean;
  subagentToolIds: Set<string>;
}

export function createActiveTurn(): ActiveTurn {
  return {
    queue: new StreamChunkQueue(),
    acceptingSubagentChunks: true,
    subagentToolIds: new Set<string>(),
  };
}

export function closeActiveTurnQueue(activeTurn: ActiveTurn): void {
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
