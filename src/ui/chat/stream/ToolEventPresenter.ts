import type { ChatMessage, ToolCallInfo } from '@pivi/core';
import type { ToolUseResult } from '@pivi/core/diff';
import { extractDiffData } from '@pivi/tools/diff';
import {
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/tools/obsidianToolNames';
import type { SubagentLifecycleAdapter } from '@pivi/tools/taskTypes';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '@pivi/tools/toolInput';
import {
  isEditTool,
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
} from '@pivi/tools/toolNames';

import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import {
  finalizeWriteEditBlock,
  updateWriteEditWithDiff,
} from '../rendering/WriteEditRenderer';
import type { ChatState } from '../state/ChatState';
import { resolveRegularToolResultStatus } from './StreamEventReducer';

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

export interface RegularToolResultChunk {
  type: 'tool_result';
  id: string;
  content: string;
  isError?: boolean;
  toolUseResult?: ToolUseResult;
}

export interface RegularToolResultDeps {
  state: ChatState;
  renderPendingTool: (toolId: string) => void;
  cancelPendingToolOutputRender: (toolId: string) => void;
  notifyVaultFileChange: (input: Record<string, unknown>) => void;
  notifyObsidianVaultPathChange: (input: Record<string, unknown>) => void;
  notifyApplyPatchFileChanges: (input: Record<string, unknown>) => void;
  showThinkingIndicator: () => void;
}

export function handleRegularToolResult(
  deps: RegularToolResultDeps,
  chunk: RegularToolResultChunk,
  msg: ChatMessage,
  normalizedContent: string,
): void {
  if (deps.state.pendingTools.has(chunk.id)) {
    deps.renderPendingTool(chunk.id);
  }

  const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
  if (!existingToolCall) {
    deps.showThinkingIndicator();
    return;
  }

  const status = resolveRegularToolResultStatus(
    existingToolCall.name,
    chunk.isError,
    normalizedContent,
  );
  const isBlocked = status === 'blocked';
  existingToolCall.status = status;
  existingToolCall.result = normalizedContent;

  applyAskUserResolvedAnswers(existingToolCall, chunk, normalizedContent);
  updateRenderedToolResult(deps, chunk, existingToolCall, isBlocked);
  notifyModifiedFiles(deps, chunk, existingToolCall, isBlocked);
  deps.showThinkingIndicator();
}

function applyAskUserResolvedAnswers(
  toolCall: ToolCallInfo,
  chunk: RegularToolResultChunk,
  normalizedContent: string,
): void {
  if (toolCall.name !== TOOL_ASK_USER_QUESTION) return;

  const answers =
    extractResolvedAnswers(chunk.toolUseResult) ??
    extractResolvedAnswersFromResultText(normalizedContent);
  if (answers) {
    toolCall.resolvedAnswers = answers;
  }
}

function updateRenderedToolResult(
  deps: RegularToolResultDeps,
  chunk: RegularToolResultChunk,
  toolCall: ToolCallInfo,
  isBlocked: boolean,
): void {
  const writeEditState = deps.state.writeEditStates.get(chunk.id);
  if (writeEditState && isWriteEditTool(toolCall.name)) {
    if (!chunk.isError && !isBlocked) {
      const diffData = extractDiffData(chunk.toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
        updateWriteEditWithDiff(writeEditState, diffData);
      }
    }
    finalizeWriteEditBlock(writeEditState, chunk.isError || isBlocked);
    return;
  }

  deps.cancelPendingToolOutputRender(chunk.id);
  updateToolCallResult(chunk.id, toolCall, deps.state.toolCallElements);
}

function notifyModifiedFiles(
  deps: RegularToolResultDeps,
  chunk: RegularToolResultChunk,
  toolCall: ToolCallInfo,
  isBlocked: boolean,
): void {
  if (chunk.isError || isBlocked) return;

  if (isEditTool(toolCall.name)) {
    deps.notifyVaultFileChange(toolCall.input);
  } else if (
    toolCall.name === TOOL_OBSIDIAN_EDIT
    || toolCall.name === TOOL_OBSIDIAN_WRITE
  ) {
    deps.notifyObsidianVaultPathChange(toolCall.input);
  }

  if (toolCall.name === TOOL_APPLY_PATCH) {
    deps.notifyApplyPatchFileChanges(toolCall.input);
  }
}
