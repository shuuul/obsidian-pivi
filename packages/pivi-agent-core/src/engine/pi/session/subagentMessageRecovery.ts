import type {
  ActivityStatus,
  ChatMessage,
  SubagentInfo,
  ToolCallInfo,
} from '../../../foundation';
import { TOOL_SPAWN_AGENT } from '../../../tools';

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
}

function activityStatusFromResult(value: unknown): ActivityStatus | undefined {
  switch (value) {
    case 'queued':
    case 'running':
    case 'waiting':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'orphaned':
      return value;
    default:
      return undefined;
  }
}

function terminalStatus(toolCall: ToolCallInfo): SubagentInfo['status'] {
  const resultStatus = toolCall.toolUseResult?.status;
  if (resultStatus === 'error') {
    return 'error';
  }
  if (resultStatus === 'completed') {
    return 'completed';
  }
  if (toolCall.status === 'error' || toolCall.status === 'blocked') {
    return 'error';
  }
  return toolCall.status;
}

function recoverSubagent(toolCall: ToolCallInfo): SubagentInfo {
  const mode = toolCall.input.run_in_background === false ? 'sync' : 'async';
  const status = terminalStatus(toolCall);
  const activityStatus = toolCall.activityStatus
    ?? activityStatusFromResult(toolCall.toolUseResult?.activity_status);
  const result = nonEmptyString(toolCall.toolUseResult?.terminal_result)
    ?? nonEmptyString(toolCall.toolUseResult?.result)
    ?? nonEmptyString(toolCall.result);
  const agentId = nonEmptyString(toolCall.toolUseResult?.agent_id)
    ?? nonEmptyString(toolCall.toolUseResult?.agentId);

  return {
    id: toolCall.id,
    description: nonEmptyString(toolCall.input.label)
      ?? nonEmptyString(toolCall.input.description)
      ?? 'Sub-agent task',
    prompt: nonEmptyString(toolCall.input.message)
      ?? nonEmptyString(toolCall.input.prompt),
    mode,
    isExpanded: toolCall.isExpanded ?? false,
    status,
    ...(activityStatus ? { activityStatus } : {}),
    toolCalls: [],
    ...(mode === 'async' ? { asyncStatus: status } : {}),
    ...(agentId ? { agentId } : {}),
    ...(result ? { result } : {}),
    ...(toolCall.startedAt !== undefined ? { startedAt: toolCall.startedAt } : {}),
    ...(toolCall.completedAt !== undefined ? { completedAt: toolCall.completedAt } : {}),
  };
}

/**
 * Pi persists spawn_agent as an ordinary tool call/result pair. The richer
 * SubagentInfo normally comes from Pivi's additive message-ui entry, but older
 * or interrupted saves can lack that overlay. Rebuild only missing presentation
 * data so complete persisted cards remain authoritative.
 */
export function recoverPiSubagentPresentation(messages: ChatMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const recoveredModes = new Map<string, SubagentInfo['mode']>();
    for (const toolCall of message.toolCalls) {
      if (toolCall.name !== TOOL_SPAWN_AGENT) {
        continue;
      }
      toolCall.subagent ??= recoverSubagent(toolCall);
      recoveredModes.set(toolCall.id, toolCall.subagent.mode);
    }

    if (recoveredModes.size === 0 || !message.contentBlocks?.length) {
      continue;
    }
    message.contentBlocks = message.contentBlocks.map((block) => {
      if (block.type !== 'tool_use') {
        return block;
      }
      const mode = recoveredModes.get(block.toolId);
      return mode
        ? { type: 'subagent', subagentId: block.toolId, mode }
        : block;
    });
  }
}
