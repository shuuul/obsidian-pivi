import type { ChatMessage, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_TODO_WRITE,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';

import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';

function isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
  return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
}
export function isAggregatablePlainToolCall(toolCall: ToolCallInfo, msg?: ChatMessage): boolean {
  if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
  if (toolCall.name === TOOL_WRITE_STDIN && isSilentWriteStdinTool(toolCall)) return false;
  if (toolCall.name === 'custom_tool_call_output') return false;

  const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(toolCall.name);
  if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

  if (isWriteEditTool(toolCall.name)) return false;
  if (isSubagentToolName(toolCall.name)) return false;
  if (toolCall.name === TOOL_TODO_WRITE || toolCall.name === TOOL_ASK_USER_QUESTION) return false;
  if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) return false;
  if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name)) return false;

  return true;
}

export function aggregateToolCallRuns(
  toolCalls: ToolCallInfo[],
  msg?: ChatMessage,
): Array<{ kind: 'single'; toolCall: ToolCallInfo } | { kind: 'group'; toolCalls: ToolCallInfo[] }> {
  const runs: Array<{ kind: 'single'; toolCall: ToolCallInfo } | { kind: 'group'; toolCalls: ToolCallInfo[] }> = [];
  let batch: ToolCallInfo[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    runs.push({ kind: 'group', toolCalls: [...batch] });
    batch = [];
  };

  for (const toolCall of toolCalls) {
    if (isAggregatablePlainToolCall(toolCall, msg)) {
      batch.push(toolCall);
    } else {
      flushBatch();
      runs.push({ kind: 'single', toolCall });
    }
  }
  flushBatch();
  return runs;
}

export function resolveAggregatableToolCall(msg: ChatMessage, toolId: string): ToolCallInfo | undefined {
  const toolCall = msg.toolCalls?.find((tc) => tc.id === toolId);
  if (!toolCall || !isAggregatablePlainToolCall(toolCall, msg)) return undefined;
  return toolCall;
}