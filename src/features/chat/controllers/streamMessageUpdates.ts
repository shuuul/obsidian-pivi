import { skipsBlockedDetection } from '../../../core/tools/toolNames';
import type { ChatMessage } from '../../../core/types';
import type { ToolCallInfo } from '../../../core/types/tools';
import { isBlockedToolResult } from '../rendering/ToolCallRenderer';

export function findMessageToolCall(
  msg: ChatMessage,
  toolId: string,
): ToolCallInfo | undefined {
  return msg.toolCalls?.find(tc => tc.id === toolId);
}

export interface MergeStreamingToolUseResult {
  merged: boolean;
  toolCall?: ToolCallInfo;
  hadNewInputKeys: boolean;
}

/** Merge streaming tool_use input into an existing tool call on the message. */
export function mergeStreamingToolUseInput(
  msg: ChatMessage,
  chunk: { id: string; name: string; input: Record<string, unknown> },
): MergeStreamingToolUseResult {
  const existingToolCall = findMessageToolCall(msg, chunk.id);
  if (!existingToolCall) {
    return { merged: false, hadNewInputKeys: false };
  }

  const newInput = chunk.input || {};
  if (Object.keys(newInput).length === 0) {
    return { merged: true, toolCall: existingToolCall, hadNewInputKeys: false };
  }

  existingToolCall.input = { ...existingToolCall.input, ...newInput };
  return { merged: true, toolCall: existingToolCall, hadNewInputKeys: true };
}

/** Register a new tool call on the message; optionally append a content block for ordering. */
export function registerMessageToolCall(
  msg: ChatMessage,
  chunk: { id: string; name: string; input: Record<string, unknown> },
  options: { contentBlock: boolean },
): ToolCallInfo {
  const toolCall: ToolCallInfo = {
    id: chunk.id,
    name: chunk.name,
    input: chunk.input,
    status: 'running',
    isExpanded: false,
  };

  msg.toolCalls = msg.toolCalls || [];
  msg.toolCalls.push(toolCall);

  if (options.contentBlock) {
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });
  }

  return toolCall;
}

/** Resolve terminal status for a regular (non-lifecycle) tool_result. */
export function resolveRegularToolResultStatus(
  toolName: string,
  isError: boolean | undefined,
  normalizedContent: string,
): ToolCallInfo['status'] {
  if (isError) {
    return 'error';
  }
  if (!skipsBlockedDetection(toolName) && isBlockedToolResult(normalizedContent, isError)) {
    return 'blocked';
  }
  return 'completed';
}
