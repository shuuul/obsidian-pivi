import type { ChatMessage, ContentBlock, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';

import { isAggregatablePlainToolCall } from './toolCallAggregation';

export function isAssistantToolStepBoundaryBlock(block: ContentBlock): boolean {
  return block.type !== 'tool_use';
}

export function shouldToolCallStayInAssistantToolStepGroup(
  toolCall: ToolCallInfo,
  msg?: ChatMessage,
): boolean {
  return isAggregatablePlainToolCall(toolCall, msg);
}
