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

function isTerminalStatus(
  status: SubagentInfo['status'] | SubagentInfo['asyncStatus'] | undefined,
): boolean {
  return status === 'completed' || status === 'error' || status === 'orphaned';
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
  if (toolCall.status === 'completed') {
    return 'completed';
  }
  return toolCall.status;
}

function recoveredResult(toolCall: ToolCallInfo): string | undefined {
  return nonEmptyString(toolCall.toolUseResult?.terminal_result)
    ?? nonEmptyString(toolCall.toolUseResult?.result)
    ?? nonEmptyString(toolCall.result);
}

function inferCancelledActivityStatus(toolCall: ToolCallInfo): ActivityStatus | undefined {
  const result = recoveredResult(toolCall);
  if (result && /^cancelled$/i.test(result.trim())) {
    return 'cancelled';
  }
  return undefined;
}

function recoverSubagent(toolCall: ToolCallInfo): SubagentInfo {
  const mode = toolCall.input.run_in_background === false ? 'sync' : 'async';
  const status = terminalStatus(toolCall);
  const activityStatus = toolCall.activityStatus
    ?? activityStatusFromResult(toolCall.toolUseResult?.activity_status)
    ?? inferCancelledActivityStatus(toolCall);
  const result = recoveredResult(toolCall);
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
 * Prefer the richer persisted overlay, but let a terminal Pi tool result upgrade
 * an incomplete/running card that never received its final message_ui patch.
 */
function mergeRecoveredSubagent(
  existing: SubagentInfo | undefined,
  recovered: SubagentInfo,
): SubagentInfo {
  if (!existing) {
    return recovered;
  }

  const existingTerminal = isTerminalStatus(existing.asyncStatus)
    || isTerminalStatus(existing.status);
  const recoveredTerminal = isTerminalStatus(recovered.asyncStatus)
    || isTerminalStatus(recovered.status);
  const mode = existing.mode ?? recovered.mode;
  const shouldUpgradeFromTerminal = recoveredTerminal && !existingTerminal;

  const status = shouldUpgradeFromTerminal
    ? recovered.status
    : (existingTerminal ? existing.status : recovered.status);
  const activityStatus = shouldUpgradeFromTerminal
    ? (recovered.activityStatus ?? (
      recovered.status === 'error' ? 'failed' : 'completed'
    ))
    : (existing.activityStatus ?? recovered.activityStatus);
  const asyncStatus = mode === 'async'
    ? (
      shouldUpgradeFromTerminal
        ? (recovered.asyncStatus ?? recovered.status)
        : (existing.asyncStatus ?? recovered.asyncStatus ?? status)
    )
    : existing.asyncStatus;

  return {
    ...existing,
    id: existing.id || recovered.id,
    description: nonEmptyString(existing.description) ?? recovered.description,
    prompt: existing.prompt ?? recovered.prompt,
    mode,
    isExpanded: existing.isExpanded,
    status,
    ...(activityStatus ? { activityStatus } : {}),
    toolCalls: existing.toolCalls.length > 0 ? existing.toolCalls : recovered.toolCalls,
    ...(asyncStatus ? { asyncStatus } : {}),
    agentId: existing.agentId ?? recovered.agentId,
    outputToolId: existing.outputToolId ?? recovered.outputToolId,
    writerName: existing.writerName ?? recovered.writerName,
    result: shouldUpgradeFromTerminal
      ? (nonEmptyString(recovered.result) ?? nonEmptyString(existing.result))
      : (nonEmptyString(existing.result) ?? recovered.result),
    startedAt: existing.startedAt ?? recovered.startedAt,
    completedAt: existing.completedAt ?? recovered.completedAt,
  };
}

/**
 * Pi persists spawn_agent as an ordinary tool call/result pair. The richer
 * SubagentInfo normally comes from Pivi's additive message-ui entry, but older
 * or interrupted saves can lack that overlay or only keep a running snapshot.
 * Rebuild missing cards and upgrade incomplete ones from the terminal Pi
 * result; complete persisted cards remain authoritative for nested traces.
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
      const recovered = recoverSubagent(toolCall);
      toolCall.subagent = mergeRecoveredSubagent(toolCall.subagent, recovered);
      if (
        toolCall.status === 'running'
        && isTerminalStatus(toolCall.subagent.status)
      ) {
        toolCall.status = toolCall.subagent.status;
      }
      toolCall.result = recoveredResult(toolCall) ?? nonEmptyString(toolCall.result);
      if (!toolCall.activityStatus && toolCall.subagent.activityStatus) {
        toolCall.activityStatus = toolCall.subagent.activityStatus;
      }
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
