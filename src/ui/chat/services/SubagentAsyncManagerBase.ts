import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import {
  type AsyncSubagentState,
  createAsyncSubagentBlock,
  finalizeAsyncSubagent,
  markAsyncSubagentOrphaned,
  updateAsyncSubagentRunning,
} from '../rendering/AsyncSubagentRenderer';
import type { SubagentRenderContentFn } from '../rendering/subagentRendererShared';
import type { HandleTaskResult, SubagentStateChangeCallback } from './subagentManagerTypes';
import type { SubagentResultParser } from './SubagentResultParser';

/**
 * Owns async/background subagent identity and lifecycle bookkeeping.
 *
 * Task tool ids, runtime agent ids, and agent-output tool ids all appear at
 * different points in the stream. Keeping those bridge maps together prevents
 * sync subagent rendering from depending on background lifecycle internals.
 */
export abstract class SubagentAsyncManagerBase {
  protected activeAsyncSubagents: Map<string, SubagentInfo> = new Map();
  protected pendingAsyncSubagents: Map<string, SubagentInfo> = new Map();
  protected taskIdToAgentId: Map<string, string> = new Map();
  protected outputToolIdToAgentId: Map<string, string> = new Map();
  protected asyncDomStates: Map<string, AsyncSubagentState> = new Map();

  protected constructor(
    protected onStateChange: SubagentStateChangeCallback,
    protected readonly taskResultInterpreter: TaskResultInterpreter,
    protected readonly parser: SubagentResultParser,
  ) {}

  protected abstract getSubagentRenderContent(): SubagentRenderContentFn | undefined;

  protected abstract assignWriterName(taskToolId: string): string;

  protected abstract updateSubagentLabel(
    wrapperEl: HTMLElement,
    info: SubagentInfo,
    newInput: Record<string, unknown>,
  ): void;

  protected setStateChangeCallback(callback: SubagentStateChangeCallback): void {
    this.onStateChange = callback;
  }

  protected createAsyncTask(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    parentEl: HTMLElement
  ): HandleTaskResult {
    const existingAsyncState = this.asyncDomStates.get(taskToolId);
    if (existingAsyncState) {
      this.updateSubagentLabel(existingAsyncState.wrapperEl, existingAsyncState.info, taskInput);
      return { action: 'created_async', info: existingAsyncState.info, domState: existingAsyncState };
    }
    const description = (taskInput.label as string) || (taskInput.description as string) || 'Background task';
    const prompt = (taskInput.message as string) || (taskInput.prompt as string) || '';

    const info: SubagentInfo = {
      id: taskToolId,
      writerName: this.assignWriterName(taskToolId),
      description,
      prompt,
      mode: 'async',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
      asyncStatus: 'pending',
    };

    this.pendingAsyncSubagents.set(taskToolId, info);

    const domState = createAsyncSubagentBlock(parentEl, taskToolId, taskInput, {
      renderContent: this.getSubagentRenderContent(),
      writerName: info.writerName,
    });
    this.asyncDomStates.set(taskToolId, domState);

    return { action: 'created_async', info, domState };
  }

  public addAsyncToolCall(parentToolUseId: string, toolCall: ToolCallInfo): void {
    const subagentState = this.asyncDomStates.get(parentToolUseId);
    const subagentInfo = this.getByTaskId(parentToolUseId) ?? subagentState?.info;
    if (!subagentState || !subagentInfo) return;

    this.upsertToolCall(subagentInfo, toolCall.id, toolCall);
    this.updateAsyncDomState(subagentInfo);
    this.onStateChange(subagentInfo);
  }

  public updateAsyncToolResult(
    parentToolUseId: string,
    toolId: string,
    toolCall: ToolCallInfo,
  ): void {
    const subagentInfo = this.getByTaskId(parentToolUseId) ?? this.asyncDomStates.get(parentToolUseId)?.info;
    if (!subagentInfo) return;

    this.upsertToolCall(subagentInfo, toolId, toolCall);
    this.updateAsyncDomState(subagentInfo);
    this.onStateChange(subagentInfo);
  }

  protected appendAsyncSubagentText(parentToolUseId: string, content: string): SubagentInfo | null {
    const subagentInfo = this.getByTaskId(parentToolUseId) ?? this.asyncDomStates.get(parentToolUseId)?.info;
    if (!subagentInfo) return null;
    subagentInfo.result = `${subagentInfo.result ?? ''}${content}`;
    this.updateAsyncDomState(subagentInfo);
    this.onStateChange(subagentInfo);
    return subagentInfo;
  }

  public handleTaskToolResult(
    taskToolId: string,
    result: unknown,
    isError?: boolean,
    toolUseResult?: unknown
  ): void {
    const subagent = this.pendingAsyncSubagents.get(taskToolId);
    if (!subagent) return;
    const resultText = extractToolResultContent(result, { fallbackIndent: 2 });

    if (isError) {
      this.transitionToError(subagent, taskToolId, resultText || 'Task failed to start');
      return;
    }

    const completedResult = this.extractCompletedAsyncToolResult(toolUseResult);
    if (completedResult?.agentId) {
      subagent.asyncStatus = completedResult.status;
      subagent.status = completedResult.status;
      subagent.agentId = completedResult.agentId;
      subagent.result = completedResult.result || resultText || (completedResult.status === 'error' ? 'Background task failed.' : 'Background task completed.');
      subagent.completedAt = Date.now();

      this.pendingAsyncSubagents.delete(taskToolId);
      this.taskIdToAgentId.set(taskToolId, completedResult.agentId);

      this.updateAsyncDomState(subagent);
      this.onStateChange(subagent);
      return;
    }

    const agentId = this.taskResultInterpreter.extractAgentId(toolUseResult) ?? this.parser.parseAgentId(resultText);

    if (!agentId) {
      const truncatedResult = resultText.length > 100 ? resultText.substring(0, 100) + '...' : resultText;
      this.transitionToError(subagent, taskToolId, `Failed to parse agent_id. Result: ${truncatedResult}`);
      return;
    }

    subagent.asyncStatus = 'running';
    subagent.agentId = agentId;
    subagent.startedAt = Date.now();

    this.pendingAsyncSubagents.delete(taskToolId);
    this.activeAsyncSubagents.set(agentId, subagent);
    this.taskIdToAgentId.set(taskToolId, agentId);

    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
  }

  public handleAgentOutputToolUse(toolCall: ToolCallInfo): void {
    const agentId = this.parser.extractAgentIdFromInput(toolCall.input);
    if (!agentId) return;

    const subagent = this.activeAsyncSubagents.get(agentId);
    if (!subagent) return;

    subagent.outputToolId = toolCall.id;
    this.outputToolIdToAgentId.set(toolCall.id, agentId);
  }

  public handleAgentOutputToolResult(
    toolId: string,
    result: unknown,
    isError: boolean,
    toolUseResult?: unknown
  ): SubagentInfo | undefined {
    const resultText = extractToolResultContent(result, { fallbackIndent: 2 });
    let agentId = this.outputToolIdToAgentId.get(toolId);
    let subagent = agentId ? this.activeAsyncSubagents.get(agentId) : undefined;

    if (!subagent) {
      const inferredAgentId = this.parser.inferAgentIdFromResult(resultText);
      if (inferredAgentId) {
        agentId = inferredAgentId;
        subagent = this.activeAsyncSubagents.get(inferredAgentId);
      }
    }

    if (!subagent) return undefined;

    if (agentId) {
      subagent.agentId = subagent.agentId || agentId;
      this.outputToolIdToAgentId.set(toolId, agentId);
    }

    if (subagent.asyncStatus !== 'running') {
      return undefined;
    }

    const stillRunning = this.parser.isStillRunningResult(resultText, isError);
    if (stillRunning) {
      this.outputToolIdToAgentId.delete(toolId);
      return subagent;
    }

    const extractedResult = this.parser.extractAgentResult(resultText, agentId ?? '', toolUseResult);

    // The chunk's is_error flag can be unreliable for async subagent results
    // (SDK may set is_error on the content block even when the agent succeeded).
    // Prefer the structured toolUseResult to determine actual error status.
    const finalStatus = this.taskResultInterpreter.resolveTerminalStatus(
      toolUseResult,
      isError ? 'error' : 'completed',
    );

    subagent.asyncStatus = finalStatus;
    subagent.status = finalStatus;
    subagent.result = extractedResult;
    subagent.completedAt = Date.now();

    if (agentId) this.activeAsyncSubagents.delete(agentId);
    this.outputToolIdToAgentId.delete(toolId);

    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
    return subagent;
  }

  public handleAsyncSubagentResult(
    agentId: string,
    status: 'completed' | 'error',
    result?: string,
    taskToolId?: string,
  ): SubagentInfo | undefined {
    const subagent = this.activeAsyncSubagents.get(agentId)
      ?? (taskToolId ? this.getByTaskId(taskToolId) : undefined);
    if (!subagent || (subagent.asyncStatus !== 'running' && subagent.asyncStatus !== 'pending')) {
      return undefined;
    }

    subagent.agentId = subagent.agentId || agentId;
    subagent.asyncStatus = status;
    subagent.status = status;
    subagent.result = this.resolveAsyncFinalResult(subagent, status, result);
    subagent.completedAt = Date.now();

    this.activeAsyncSubagents.delete(agentId);
    if (taskToolId) {
      this.pendingAsyncSubagents.delete(taskToolId);
      this.taskIdToAgentId.set(taskToolId, agentId);
    }
    this.unlinkOutputToolsForAgent(agentId);

    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
    return subagent;
  }

  private resolveAsyncFinalResult(
    subagent: SubagentInfo,
    status: 'completed' | 'error',
    result: string | undefined,
  ): string {
    const next = result?.trim();
    const existing = subagent.result?.trim();
    const genericCompleted = 'Background task completed.';
    const genericFailed = 'Background task failed.';
    if (next && !(existing && (next === genericCompleted || next === genericFailed))) {
      return next;
    }
    if (existing) {
      return existing;
    }
    return status === 'error' ? genericFailed : genericCompleted;
  }

  public isPendingAsyncTask(taskToolId: string): boolean {
    return this.pendingAsyncSubagents.has(taskToolId);
  }

  public hasAsyncTask(taskToolId: string): boolean {
    return this.pendingAsyncSubagents.has(taskToolId) || this.asyncDomStates.has(taskToolId) || this.taskIdToAgentId.has(taskToolId);
  }

  public isLinkedAgentOutputTool(toolId: string): boolean {
    return this.outputToolIdToAgentId.has(toolId);
  }

  public getByTaskId(taskToolId: string): SubagentInfo | undefined {
    const pending = this.pendingAsyncSubagents.get(taskToolId);
    if (pending) return pending;

    const domState = this.asyncDomStates.get(taskToolId);
    const agentId = this.taskIdToAgentId.get(taskToolId);
    if (agentId) {
      return this.activeAsyncSubagents.get(agentId) ?? domState?.info;
    }

    return domState?.info;
  }

  /**
   * Re-renders an async subagent after data-only updates (for example,
   * hydrating tool calls from SDK sidecar files) without changing lifecycle state.
   */
  public refreshAsyncSubagent(subagent: SubagentInfo): void {
    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
  }

  public hasRunningSubagents(): boolean {
    // pendingAsyncSubagents: awaiting agent_id; activeAsyncSubagents: only holds running entries
    return this.pendingAsyncSubagents.size > 0 || this.activeAsyncSubagents.size > 0;
  }

  public orphanAllActive(): SubagentInfo[] {
    const orphaned: SubagentInfo[] = [];

    for (const subagent of this.pendingAsyncSubagents.values()) {
      this.markOrphaned(subagent);
      orphaned.push(subagent);
    }

    for (const subagent of this.activeAsyncSubagents.values()) {
      if (subagent.asyncStatus === 'running') {
        this.markOrphaned(subagent);
        orphaned.push(subagent);
      }
    }

    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();

    return orphaned;
  }

  protected clearAsyncState(): void {
    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();
    this.asyncDomStates.clear();
  }

  private upsertToolCall(subagentInfo: SubagentInfo, toolId: string, toolCall: ToolCallInfo): void {
    const existingIndex = subagentInfo.toolCalls.findIndex(tc => tc.id === toolId);
    if (existingIndex >= 0) {
      subagentInfo.toolCalls[existingIndex] = {
        ...subagentInfo.toolCalls[existingIndex],
        ...toolCall,
        input: {
          ...subagentInfo.toolCalls[existingIndex].input,
          ...toolCall.input,
        },
      };
    } else {
      subagentInfo.toolCalls.push(toolCall);
    }
  }

  private markOrphaned(subagent: SubagentInfo): void {
    subagent.asyncStatus = 'orphaned';
    subagent.status = 'error';
    subagent.result = 'Session ended before task completed';
    subagent.completedAt = Date.now();
    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
  }

  private transitionToError(subagent: SubagentInfo, taskToolId: string, errorResult: string): void {
    subagent.asyncStatus = 'error';
    subagent.status = 'error';
    subagent.result = errorResult;
    subagent.completedAt = Date.now();
    this.pendingAsyncSubagents.delete(taskToolId);
    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
  }

  private unlinkOutputToolsForAgent(agentId: string): void {
    for (const [toolId, mappedAgentId] of this.outputToolIdToAgentId.entries()) {
      if (mappedAgentId === agentId) {
        this.outputToolIdToAgentId.delete(toolId);
      }
    }
  }

  private extractCompletedAsyncToolResult(toolUseResult: unknown): {
    agentId: string;
    status: 'completed' | 'error';
    result: string;
  } | null {
    if (!toolUseResult || typeof toolUseResult !== 'object' || Array.isArray(toolUseResult)) {
      return null;
    }
    const record = toolUseResult as Record<string, unknown>;
    const agentId = typeof record.agent_id === 'string'
      ? record.agent_id
      : typeof record.agentId === 'string'
        ? record.agentId
        : null;
    if (!agentId) return null;
    const status = record.status === 'error' ? 'error' : record.status === 'completed' ? 'completed' : null;
    if (!status) return null;
    const result = typeof record.result === 'string' ? record.result : '';
    return { agentId, status, result };
  }

  private updateAsyncDomState(subagent: SubagentInfo): void {
    // Find DOM state by task ID first, then by agentId
    let asyncState = this.asyncDomStates.get(subagent.id);

    if (!asyncState) {
      for (const s of this.asyncDomStates.values()) {
        if (s.info.agentId === subagent.agentId) {
          asyncState = s;
          break;
        }
      }
      if (!asyncState) return;
    }

    const currentExpandedState = asyncState.info.isExpanded;
    Object.assign(asyncState.info, subagent, { isExpanded: currentExpandedState });
    if (subagent !== asyncState.info) {
      Object.assign(subagent, asyncState.info);
    }

    switch (subagent.asyncStatus) {
      case 'pending':
      case 'running':
        updateAsyncSubagentRunning(asyncState, subagent.agentId || '', subagent.asyncStatus);
        break;

      case 'completed':
      case 'error':
        finalizeAsyncSubagent(asyncState, subagent.result || '', subagent.asyncStatus === 'error');
        break;

      case 'orphaned':
        markAsyncSubagentOrphaned(asyncState);
        break;
    }
  }
}
