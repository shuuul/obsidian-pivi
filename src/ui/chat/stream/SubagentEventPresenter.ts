import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation/tools';
import type { SubagentLifecycleAdapter } from '@pivi/pivi-agent-core/tools';

export type SubagentLifecycleToolKind = 'spawn' | 'wait' | 'close';

export interface SubagentSpawnResultUpdate {
  kind: 'spawn';
  spawnToolId: string;
  agentId?: string;
  normalizedContent: string;
  isError: boolean;
}

export interface SubagentWaitResultUpdate {
  kind: 'wait';
  waitToolId: string;
  spawnToolIds: string[];
  normalizedContent: string;
  isError: boolean;
}

export interface SubagentCloseResultUpdate {
  kind: 'close';
  closeToolId: string;
  normalizedContent: string;
  isError: boolean;
}

export type SubagentLifecycleResultUpdate =
  | SubagentSpawnResultUpdate
  | SubagentWaitResultUpdate
  | SubagentCloseResultUpdate;

export function classifySubagentLifecycleTool(
  adapter: SubagentLifecycleAdapter,
  toolName: string,
): SubagentLifecycleToolKind | null {
  if (adapter.isSpawnTool(toolName)) {
    return 'spawn';
  }
  if (adapter.isWaitTool(toolName)) {
    return 'wait';
  }
  if (adapter.isCloseTool(toolName)) {
    return 'close';
  }
  return null;
}

/**
 * Apply provider lifecycle subagent tool_result to the message model.
 * Returns null when the tool is not owned by the lifecycle adapter.
 */
export function applySubagentLifecycleToolResult(
  existingToolCall: ToolCallInfo,
  chunk: { id: string; content: string; isError?: boolean },
  normalizedContent: string,
  adapter: SubagentLifecycleAdapter,
  agentIdToSpawnId: ReadonlyMap<string, string>,
): SubagentLifecycleResultUpdate | null {
  const kind = classifySubagentLifecycleTool(adapter, existingToolCall.name);
  if (!kind) {
    return null;
  }

  existingToolCall.status = chunk.isError ? 'error' : 'completed';
  existingToolCall.result = normalizedContent;

  if (kind === 'spawn') {
    const spawnResult = adapter.extractSpawnResult(normalizedContent);
    return {
      kind: 'spawn',
      spawnToolId: chunk.id,
      agentId: spawnResult.agentId,
      normalizedContent,
      isError: !!chunk.isError,
    };
  }

  if (kind === 'wait') {
    return {
      kind: 'wait',
      waitToolId: chunk.id,
      spawnToolIds: adapter.resolveSpawnToolIds(existingToolCall, agentIdToSpawnId),
      normalizedContent,
      isError: !!chunk.isError,
    };
  }

  return {
    kind: 'close',
    closeToolId: chunk.id,
    normalizedContent,
    isError: !!chunk.isError,
  };
}
