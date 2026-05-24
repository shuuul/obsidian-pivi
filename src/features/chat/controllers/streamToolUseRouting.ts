import type { SubagentLifecycleAdapter } from '../../../core/agent/types';
import {
  isSubagentToolName,
  TOOL_AGENT_OUTPUT,
} from '../../../core/tools/toolNames';

/** Dispatch target for an incoming `tool_use` stream chunk. */
export type ToolUseStreamRoute =
  | 'subagent_task'
  | 'agent_output'
  | 'subagent_spawn'
  | 'subagent_hidden'
  | 'regular';

/** Classify how StreamController should handle a tool_use chunk. */
export function routeToolUseStreamChunk(
  toolName: string,
  lifecycleAdapter: SubagentLifecycleAdapter | null,
): ToolUseStreamRoute {
  if (isSubagentToolName(toolName)) {
    return 'subagent_task';
  }
  if (toolName === TOOL_AGENT_OUTPUT) {
    return 'agent_output';
  }
  if (lifecycleAdapter?.isSpawnTool(toolName)) {
    return 'subagent_spawn';
  }
  if (lifecycleAdapter?.isHiddenTool(toolName)) {
    return 'subagent_hidden';
  }
  return 'regular';
}
