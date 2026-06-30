import { parseTodoInput } from '../../../core/tools/todo';
import {
  isWriteEditTool,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import {
  getToolName,
  getToolSummary,
  renderToolCall,
} from '../rendering/ToolCallRenderer';
import { createWriteEditBlock } from '../rendering/WriteEditRenderer';
import type { ChatState } from '../state/ChatState';
import {
  mergeStreamingToolUseInput,
  registerMessageToolCall,
} from './streamMessageUpdates';

export interface RegularToolUseChunk {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolOutputChunk {
  type: 'tool_output';
  id: string;
  content: string;
}

export interface PendingToolRenderingDeps {
  state: ChatState;
  capturePlanFilePath: (input: Record<string, unknown>) => void;
  showThinkingIndicator: () => void;
  scheduleToolOutputRender: (toolId: string, toolCall: ToolCallInfo) => void;
}

export class PendingToolRendering {
  constructor(private readonly deps: PendingToolRenderingDeps) {}

  /**
   * Registers and renders regular tool_use chunks as soon as they arrive.
   *
   * Some providers stream tool_use before tool_result with a noticeable delay. If
   * we wait for the result before rendering, the chat appears to leave a blank
   * gap after the previous content. Later input deltas still merge into the same
   * ToolCallInfo and update the rendered header.
   */
  handleRegularToolUse(chunk: RegularToolUseChunk, msg: ChatMessage): void {
    const { state } = this.deps;

    const mergeResult = mergeStreamingToolUseInput(msg, chunk);
    if (mergeResult.merged && mergeResult.toolCall) {
      if (mergeResult.hadNewInputKeys) {
        this.handleMergedToolInput(chunk.id, mergeResult.toolCall);
      }
      return;
    }

    const toolCall = registerMessageToolCall(msg, chunk, { contentBlock: true });
    this.applyInputSideEffects(chunk.name, chunk.input);

    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      this.renderPendingTool(chunk.id);
      this.deps.showThinkingIndicator();
    }
  }

  /**
   * Renders all pending tool calls in insertion order.
   */
  flushPendingTools(): void {
    const { state } = this.deps;

    if (state.pendingTools.size === 0) {
      return;
    }

    for (const toolId of state.pendingTools.keys()) {
      this.renderPendingTool(toolId);
    }

    state.pendingTools.clear();
  }

  /**
   * Renders a single pending tool call and moves it from pending to rendered state.
   */
  renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending) return;

    const { toolCall, parentEl } = pending;
    if (!parentEl) return;
    if (isWriteEditTool(toolCall.name)) {
      const writeEditState = createWriteEditBlock(parentEl, toolCall);
      state.writeEditStates.set(toolId, writeEditState);
      state.toolCallElements.set(toolId, writeEditState.wrapperEl);
    } else {
      renderToolCall(parentEl, toolCall, state.toolCallElements);
    }
    state.pendingTools.delete(toolId);
  }

  handleToolOutput(chunk: ToolOutputChunk, msg: ChatMessage): void {
    const { state } = this.deps;

    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) {
      return;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    this.deps.scheduleToolOutputRender(chunk.id, existingToolCall);
    this.deps.showThinkingIndicator();
  }

  private handleMergedToolInput(toolId: string, toolCall: ToolCallInfo): void {
    this.applyInputSideEffects(toolCall.name, toolCall.input);

    const toolEl = this.deps.state.toolCallElements.get(toolId);
    if (!toolEl) return;

    const nameEl = toolEl.querySelector('.pivi-tool-name')
      ?? toolEl.querySelector('.pivi-write-edit-name');
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
    }
    const summaryEl = toolEl.querySelector('.pivi-tool-summary')
      ?? toolEl.querySelector('.pivi-write-edit-summary');
    if (summaryEl) {
      summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
    }
  }

  private applyInputSideEffects(toolName: string, input: Record<string, unknown>): void {
    if (toolName === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      }
    }

    if (toolName === TOOL_WRITE) {
      this.deps.capturePlanFilePath(input);
    }
  }
}
