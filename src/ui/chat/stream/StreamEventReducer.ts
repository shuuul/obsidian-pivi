import { skipsBlockedDetection } from '@pivi/agent/tools/toolNames';
import type { ToolCallInfo } from '@pivi/agent/tools/types';

import { isBlockedToolResult } from '../rendering/ToolCallRenderer';

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
