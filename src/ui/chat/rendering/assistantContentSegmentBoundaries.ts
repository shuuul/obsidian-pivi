import type { ContentBlock, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';

import { isAggregatablePlainToolCall } from './toolCallAggregation';

export function isAssistantToolStepBoundaryBlock(block: ContentBlock): boolean {
  return block.type !== 'tool_use';
}

export function shouldToolCallStayInAssistantToolStepGroup(toolCall: ToolCallInfo): boolean {
  return isAggregatablePlainToolCall(toolCall);
}
