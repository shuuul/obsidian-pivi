import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { SubagentLifecycleAdapter } from '@pivi/pivi-agent-core/tools';
import {
  isSubagentToolName,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import { registerMessageToolCall } from '@/ui/chat/stream/StreamEventReducer';
import { applySubagentLifecycleToolResult } from '@/ui/chat/stream/SubagentEventPresenter';

import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
import { isBlockedToolResult } from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import { clearStreamingToolStepGroup } from './PendingToolPresenter';

const ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

interface SubagentStreamUpdateOptions {
  showThinkingIndicator?: boolean;
}

export interface StreamSubagentCoordinatorDeps {
  state: ChatState;
  subagentManager: SubagentManager;
  getAgentService?: () => PiChatService | null;
  flushPendingTools: () => void;
  showThinkingIndicator: () => void;
  scrollToBottom: () => void;
}

export class StreamSubagentCoordinator {
  private lifecycleSubagentStates = new Map<string, SubagentState>();
  private lifecycleAgentIdToSpawnId = new Map<string, string>();
  private subagentDockEls = new Map<string, HTMLElement>();

  constructor(private readonly deps: StreamSubagentCoordinatorDeps) {}

  private getSubagentDockForTask(toolId: string): HTMLElement | null {
    const { currentContentEl } = this.deps.state;
    if (!currentContentEl) return null;
    clearStreamingToolStepGroup(this.deps.state);

    const existingDockEl = this.subagentDockEls.get(toolId);
    if (existingDockEl && existingDockEl.isConnected !== false && currentContentEl.contains(existingDockEl)) {
      return existingDockEl;
    }

    const dockEl = currentContentEl.createDiv({ cls: 'pivi-subagent-dock' });
    this.subagentDockEls.set(toolId, dockEl);
    return dockEl;
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  private getSubagentLifecycleAdapter(toolName?: string): SubagentLifecycleAdapter | null {
    return resolveSubagentLifecycleAdapter(toolName);
  }

  handleSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: SubagentLifecycleAdapter,
  ): void {
    const toolCall = registerMessageToolCall(msg, chunk, { contentBlock: true });

    const subagentDockEl = this.getSubagentDockForTask(chunk.id);
    if (subagentDockEl) {
      this.deps.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);

      const subagentState = createSubagentBlock(subagentDockEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
  }

  handleHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
  ): void {
    registerMessageToolCall(msg, chunk, { contentBlock: false });
  }

  handleSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage,
  ): boolean {
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) return false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    const adapter = this.getSubagentLifecycleAdapter(existingToolCall.name);
    if (!adapter) return false;

    const lifecycleUpdate = applySubagentLifecycleToolResult(
      existingToolCall,
      chunk,
      normalizedContent,
      adapter,
      this.lifecycleAgentIdToSpawnId,
    );
    if (!lifecycleUpdate) {
      return false;
    }

    if (lifecycleUpdate.kind === 'spawn') {
      if (lifecycleUpdate.agentId) {
        this.lifecycleAgentIdToSpawnId.set(lifecycleUpdate.agentId, lifecycleUpdate.spawnToolId);
      }

      const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
      const subagentState = this.lifecycleSubagentStates.get(lifecycleUpdate.spawnToolId);
      if (subagentState) {
        subagentState.info.description = subagentInfo.description;
        subagentState.info.prompt = subagentInfo.prompt;
        subagentState.labelEl.setText(
          subagentInfo.description.length > 40
            ? subagentInfo.description.substring(0, 40) + '...'
            : subagentInfo.description
        );
      }

      if (lifecycleUpdate.isError && subagentState) {
        finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
      }
      return true;
    }

    if (lifecycleUpdate.kind === 'wait') {
      for (const spawnId of lifecycleUpdate.spawnToolIds) {
        const spawnToolCall = msg.toolCalls?.find(tc => tc.id === spawnId);
        const subagentState = this.lifecycleSubagentStates.get(spawnId);
        if (!spawnToolCall || !subagentState) continue;

        const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
        subagentState.info.description = subagentInfo.description;
        subagentState.info.prompt = subagentInfo.prompt;

        if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
          finalizeSubagentBlock(
            subagentState,
            subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
            subagentInfo.status === 'error'
          );
        }
      }
      return true;
    }

    return true;
  }

  handleTaskToolUseViaManager(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
  ): void {
    const { subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input, chunk.name);
    this.ensureSubagentContentBlock(
      msg,
      chunk.id,
      chunk.input.run_in_background === true ? 'async' : undefined,
    );

    const result = subagentManager.handleTaskToolUse(
      chunk.id,
      chunk.input,
      this.getSubagentDockForTask(chunk.id),
      chunk.name,
    );

    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.deps.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.deps.showThinkingIndicator();
        break;
      case 'buffered':
        this.deps.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  renderPendingTaskViaManager(
    toolId: string,
    msg: ChatMessage,
  ): void {
    const result = this.deps.subagentManager.renderPendingTask(toolId);
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, toolId);
    } else {
      this.recordSubagentInMessage(msg, result.info, toolId, 'async');
    }
  }

  renderPendingTaskFromTaskResultViaManager(
    chunk: { id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage,
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.getSubagentDockForTask(chunk.id),
      chunk.toolUseResult
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async',
  ): void {
    const taskToolCall = this.ensureTaskToolCall(
      msg,
      toolId,
      undefined,
      mode === 'async' || info.mode === 'async' ? TOOL_SPAWN_AGENT : TOOL_TASK,
    );
    this.applySubagentToTaskToolCall(taskToolCall, info);

    this.ensureSubagentContentBlock(msg, toolId, mode);
  }

  private ensureSubagentContentBlock(
    msg: ChatMessage,
    toolId: string,
    mode?: 'async',
  ): void {
    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId }
      );
    }
  }

  handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
    options: SubagentStreamUpdateOptions = {},
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    if (subagentManager.hasPendingTask(parentToolUseId)) {
      this.renderPendingTaskViaManager(parentToolUseId, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);

    switch (chunk.type) {
      case 'subagent_tool_use': {
        const toolCall: ToolCallInfo = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: 'running',
          isExpanded: false,
        };
        if (subagentState) {
          subagentManager.addSyncToolCall(parentToolUseId, toolCall);
        } else if (subagentManager.hasAsyncTask(parentToolUseId)) {
          subagentManager.addAsyncToolCall(parentToolUseId, toolCall);
        } else {
          return Promise.resolve();
        }
        this.showThinkingIndicator(options);
        break;
      }

      case 'subagent_tool_result': {
        const subagentInfo = subagentState?.info ?? subagentManager.getByTaskId(parentToolUseId);
        const toolCall = subagentInfo?.toolCalls.find((tc: ToolCallInfo) => tc.id === chunk.id);
        if (toolCall) {
          const normalizedContent = this.normalizeToolResultContent(chunk.content);
          const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
          toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          toolCall.result = normalizedContent;
          if (subagentState) {
            subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
          } else {
            subagentManager.updateAsyncToolResult(parentToolUseId, chunk.id, toolCall);
          }
        }
        break;
      }

      default:
        break;
    }
    return Promise.resolve();
  }

  handleSubagentText(
    chunk: Extract<StreamChunk, { type: 'subagent_text' }>,
    msg: ChatMessage,
    options: SubagentStreamUpdateOptions = {},
  ): void {
    if (this.deps.subagentManager.hasPendingTask(chunk.subagentId)) {
      this.renderPendingTaskViaManager(chunk.subagentId, msg);
    }

    const subagent = this.deps.subagentManager.appendSubagentText(chunk.subagentId, chunk.content);
    if (!subagent) return;
    this.recordSubagentInMessage(
      msg,
      subagent,
      chunk.subagentId,
      subagent.mode === 'async' ? 'async' : undefined,
    );
    this.showThinkingIndicator(options);
  }

  finalizeSubagent(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage,
  ): void {
    const isError = chunk.isError || false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);
    const finalized = this.deps.subagentManager.finalizeSyncSubagent(
      chunk.id, chunk.content, isError, chunk.toolUseResult
    );

    const extractedResult = finalized?.result ?? normalizedContent;

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    if (taskToolCall.subagent) {
      taskToolCall.subagent.status = isError ? 'error' : 'completed';
      taskToolCall.subagent.result = extractedResult;
    }

    if (finalized) {
      this.applySubagentToTaskToolCall(taskToolCall, finalized);
    }

    this.deps.showThinkingIndicator();
  }

  handleAgentOutputToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    _msg: ChatMessage,
  ): void {
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };

    this.deps.subagentManager.handleAgentOutputToolUse(toolCall);
    this.deps.showThinkingIndicator();
  }

  handleAsyncTaskToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
  ): boolean {
    const { subagentManager } = this.deps;
    if (subagentManager.isPendingAsyncTask(chunk.id)) {
      subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
      return true;
    }

    // Background subagents can emit their terminal async result just before the
    // parent spawn_agent tool result resolves. In that order the async task has
    // already been finalized by task id, so swallow the duplicate tool result
    // instead of rendering spawn_agent as a regular tool.
    return subagentManager.hasAsyncTask(chunk.id);
  }

  async handleAgentOutputToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
  ): Promise<boolean> {
    const { subagentManager } = this.deps;
    const isLinked = subagentManager.isLinkedAgentOutputTool(chunk.id);

    const handled = subagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      chunk.toolUseResult
    );

    await this.hydrateAsyncSubagentToolCalls(handled);

    return isLinked || handled !== undefined;
  }

  async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>,
    options: SubagentStreamUpdateOptions = {},
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result,
      chunk.subagentId,
    );

    await this.hydrateAsyncSubagentToolCalls(handled);
    if (handled) {
      this.showThinkingIndicator(options);
    }
  }

  private showThinkingIndicator(options: SubagentStreamUpdateOptions): void {
    if (options.showThinkingIndicator === false) {
      return;
    }
    this.deps.showThinkingIndicator();
  }

  resetStreamingState(): void {
    this.lifecycleSubagentStates.clear();
    this.lifecycleAgentIdToSpawnId.clear();
    this.subagentDockEls.clear();
  }

  private async hydrateAsyncSubagentToolCalls(subagent: SubagentInfo | undefined): Promise<void> {
    if (!subagent) return;
    if (subagent.mode !== 'async') return;
    if (!subagent.agentId) return;

    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const runtime = this.deps.getAgentService?.();
    if (!runtime) return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      true
    );

    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, 0);
    }
  }

  private async tryHydrateAsyncSubagent(
    subagent: SubagentInfo,
    runtime: PiChatService,
    hydrateToolCalls: boolean,
  ): Promise<{ hasHydrated: boolean; finalResultHydrated: boolean }> {
    let hasHydrated = false;
    let finalResultHydrated = false;

    if (hydrateToolCalls && !subagent.toolCalls?.length) {
      const recoveredToolCalls = await runtime.loadSubagentToolCalls?.(
        subagent.agentId || ''
      ) ?? [];
      if (recoveredToolCalls.length > 0) {
        subagent.toolCalls = recoveredToolCalls.map((toolCall) => ({
          ...toolCall,
          input: { ...toolCall.input },
        }));
        hasHydrated = true;
      }
    }

    const recoveredFinalResult = await runtime.loadSubagentFinalResult?.(
      subagent.agentId || ''
    ) ?? null;
    if (recoveredFinalResult && recoveredFinalResult.trim().length > 0) {
      finalResultHydrated = true;
      if (recoveredFinalResult !== subagent.result) {
        subagent.result = recoveredFinalResult;
        hasHydrated = true;
      }
    }

    return { hasHydrated, finalResultHydrated };
  }

  private scheduleAsyncSubagentResultRetry(
    subagent: SubagentInfo,
    runtime: PiChatService,
    attempt: number,
  ): void {
    if (!subagent.agentId) return;
    if (attempt >= ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS.length) return;

    const delay = ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS[attempt];
    window.setTimeout(() => {
      void this.retryAsyncSubagentResult(subagent, runtime, attempt);
    }, delay);
  }

  private async retryAsyncSubagentResult(
    subagent: SubagentInfo,
    runtime: PiChatService,
    attempt: number,
  ): Promise<void> {
    if (!subagent.agentId) return;
    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      false
    );
    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, attempt + 1);
    }
  }

  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.updateSubagentInMessages(subagent);
    this.deps.scrollToBottom();
  }

  private updateSubagentInMessages(subagent: SubagentInfo): void {
    const { state } = this.deps;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) {
        return;
      }
    }
  }

  ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>,
    toolName: string = TOOL_TASK,
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existing = msg.toolCalls.find(
      tc => tc.id === toolId && isSubagentToolName(tc.name)
    );
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: toolName,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private applySubagentToTaskToolCall(taskToolCall: ToolCallInfo, subagent: SubagentInfo): void {
    taskToolCall.subagent = subagent;
    if (subagent.status === 'completed') taskToolCall.status = 'completed';
    else if (subagent.status === 'error') taskToolCall.status = 'error';
    else taskToolCall.status = 'running';
    if (subagent.result !== undefined) {
      taskToolCall.result = subagent.result;
    }
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCall = msg.toolCalls?.find(
      tc => tc.id === subagent.id && isSubagentToolName(tc.name)
    );
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }
}
