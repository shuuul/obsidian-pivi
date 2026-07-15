import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import type { SubagentStateChangeCallback } from './subagentManagerTypes';
import type { SubagentResultParser } from './SubagentResultParser';

/**
 * Owns async/background subagent identity and lifecycle bookkeeping.
 *
 * Task tool ids, runtime agent ids, and agent-output tool ids all appear at
 * different points in the stream. These records are presentation-agnostic so
 * the React message projection can render them in its own realm.
 */
export abstract class SubagentAsyncManagerBase {
  protected activeAsyncSubagents = new Map<string, SubagentInfo>();
  protected pendingAsyncSubagents = new Map<string, SubagentInfo>();
  protected asyncSubagents = new Map<string, SubagentInfo>();
  protected taskIdToAgentId = new Map<string, string>();
  protected outputToolIdToAgentId = new Map<string, string>();

  protected constructor(
    protected onStateChange: SubagentStateChangeCallback,
    protected readonly taskResultInterpreter: TaskResultInterpreter,
    protected readonly parser: SubagentResultParser,
  ) {}

  protected abstract assignWriterName(taskToolId: string): string;

  protected setStateChangeCallback(callback: SubagentStateChangeCallback): void {
    this.onStateChange = callback;
  }

  protected createAsyncTask(taskToolId: string, taskInput: Record<string, unknown>): SubagentInfo {
    const existing = this.asyncSubagents.get(taskToolId);
    if (existing) {
      this.updateSubagentInput(existing, taskInput);
      return existing;
    }

    const info: SubagentInfo = {
      id: taskToolId,
      writerName: this.assignWriterName(taskToolId),
      description: this.descriptionFromInput(taskInput),
      prompt: this.promptFromInput(taskInput),
      mode: 'async',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
      asyncStatus: 'pending',
    };
    this.pendingAsyncSubagents.set(taskToolId, info);
    this.asyncSubagents.set(taskToolId, info);
    return info;
  }

  protected updateSubagentInput(subagent: SubagentInfo, input: Record<string, unknown>): void {
    const description = this.descriptionFromInput(input);
    const prompt = this.promptFromInput(input);
    if (description) subagent.description = description;
    if (prompt) subagent.prompt = prompt;
  }

  protected descriptionFromInput(input: Record<string, unknown>): string {
    return (input.label as string) || (input.description as string) || '';
  }

  protected promptFromInput(input: Record<string, unknown>): string {
    return (input.message as string) || (input.prompt as string) || '';
  }

  public addAsyncToolCall(parentToolUseId: string, toolCall: ToolCallInfo): void {
    const subagent = this.getByTaskId(parentToolUseId);
    if (!subagent) return;
    this.markAsyncActivityStarted(subagent);
    this.upsertToolCall(subagent, toolCall.id, toolCall);
    this.onStateChange(subagent);
  }

  public updateAsyncToolResult(parentToolUseId: string, toolId: string, toolCall: ToolCallInfo): void {
    const subagent = this.getByTaskId(parentToolUseId);
    if (!subagent) return;
    this.upsertToolCall(subagent, toolId, toolCall);
    this.onStateChange(subagent);
  }

  protected appendAsyncSubagentText(parentToolUseId: string, content: string): SubagentInfo | null {
    const subagent = this.getByTaskId(parentToolUseId);
    if (!subagent) return null;
    this.markAsyncActivityStarted(subagent);
    subagent.result = `${subagent.result ?? ''}${content}`;
    this.onStateChange(subagent);
    return subagent;
  }

  public handleTaskToolResult(taskToolId: string, result: unknown, isError?: boolean, toolUseResult?: unknown): void {
    const subagent = this.pendingAsyncSubagents.get(taskToolId);
    if (!subagent) return;
    const resultText = extractToolResultContent(result, { fallbackIndent: 2 });

    if (isError) {
      this.transitionToError(
        subagent,
        taskToolId,
        resultText || 'Task failed to start',
        this.explicitActivityStatus(toolUseResult),
      );
      return;
    }

    const completedResult = this.extractCompletedAsyncToolResult(toolUseResult);
    if (completedResult?.agentId) {
      subagent.asyncStatus = completedResult.status;
      subagent.status = completedResult.status;
      subagent.activityStatus = completedResult.activityStatus;
      subagent.agentId = completedResult.agentId;
      subagent.result = completedResult.result || resultText || (completedResult.status === 'error' ? 'Background task failed.' : 'Background task completed.');
      subagent.completedAt = Date.now();
      this.pendingAsyncSubagents.delete(taskToolId);
      this.taskIdToAgentId.set(taskToolId, completedResult.agentId);
      this.onStateChange(subagent);
      return;
    }

    const agentId = this.taskResultInterpreter.extractAgentId(toolUseResult) ?? this.parser.parseAgentId(resultText);
    if (!agentId) {
      const truncatedResult = resultText.length > 100 ? `${resultText.substring(0, 100)}...` : resultText;
      this.transitionToError(subagent, taskToolId, `Failed to parse agent_id. Result: ${truncatedResult}`);
      return;
    }

    subagent.asyncStatus = 'running';
    subagent.agentId = agentId;
    subagent.startedAt = Date.now();
    this.pendingAsyncSubagents.delete(taskToolId);
    this.activeAsyncSubagents.set(agentId, subagent);
    this.taskIdToAgentId.set(taskToolId, agentId);
    this.onStateChange(subagent);
  }

  public handleAgentOutputToolUse(toolCall: ToolCallInfo): void {
    const agentId = this.parser.extractAgentIdFromInput(toolCall.input);
    if (!agentId || !this.activeAsyncSubagents.has(agentId)) return;
    const subagent = this.activeAsyncSubagents.get(agentId)!;
    subagent.outputToolId = toolCall.id;
    this.outputToolIdToAgentId.set(toolCall.id, agentId);
  }

  public handleAgentOutputToolResult(toolId: string, result: unknown, isError: boolean, toolUseResult?: unknown): SubagentInfo | undefined {
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
    if (!subagent || subagent.asyncStatus !== 'running') return undefined;

    if (agentId) {
      subagent.agentId ||= agentId;
      this.outputToolIdToAgentId.set(toolId, agentId);
    }
    if (this.parser.isStillRunningResult(resultText, isError)) {
      this.outputToolIdToAgentId.delete(toolId);
      return subagent;
    }

    const finalStatus = this.taskResultInterpreter.resolveTerminalStatus(toolUseResult, isError ? 'error' : 'completed');
    subagent.asyncStatus = finalStatus;
    subagent.status = finalStatus;
    subagent.activityStatus = this.explicitActivityStatus(toolUseResult);
    subagent.result = this.parser.extractAgentResult(resultText, agentId ?? '', toolUseResult);
    subagent.completedAt = Date.now();
    if (agentId) this.activeAsyncSubagents.delete(agentId);
    this.outputToolIdToAgentId.delete(toolId);
    this.onStateChange(subagent);
    return subagent;
  }

  public handleAsyncSubagentResult(agentId: string, status: 'completed' | 'error', result?: string, taskToolId?: string, activityStatus?: 'cancelled'): SubagentInfo | undefined {
    const subagent = this.activeAsyncSubagents.get(agentId) ?? (taskToolId ? this.getByTaskId(taskToolId) : undefined);
    if (!subagent || (subagent.asyncStatus !== 'running' && subagent.asyncStatus !== 'pending')) return undefined;

    subagent.agentId ||= agentId;
    subagent.asyncStatus = status;
    subagent.status = status;
    subagent.activityStatus = activityStatus;
    subagent.result = this.resolveAsyncFinalResult(subagent, status, result);
    subagent.completedAt = Date.now();
    this.activeAsyncSubagents.delete(agentId);
    if (taskToolId) {
      this.pendingAsyncSubagents.delete(taskToolId);
      this.taskIdToAgentId.set(taskToolId, agentId);
    }
    this.unlinkOutputToolsForAgent(agentId);
    this.onStateChange(subagent);
    return subagent;
  }

  public isPendingAsyncTask(taskToolId: string): boolean {
    return this.pendingAsyncSubagents.has(taskToolId);
  }

  public hasAsyncTask(taskToolId: string): boolean {
    return this.asyncSubagents.has(taskToolId) || this.taskIdToAgentId.has(taskToolId);
  }

  public isLinkedAgentOutputTool(toolId: string): boolean {
    return this.outputToolIdToAgentId.has(toolId);
  }

  public getByTaskId(taskToolId: string): SubagentInfo | undefined {
    return this.asyncSubagents.get(taskToolId);
  }

  public refreshAsyncSubagent(subagent: SubagentInfo): void {
    if (!this.asyncSubagents.has(subagent.id)) return;
    this.onStateChange(subagent);
  }

  public hasRunningSubagents(): boolean {
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
    this.asyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();
  }

  private resolveAsyncFinalResult(subagent: SubagentInfo, status: 'completed' | 'error', result: string | undefined): string {
    const next = result?.trim();
    const existing = subagent.result?.trim();
    const genericCompleted = 'Background task completed.';
    const genericFailed = 'Background task failed.';
    if (next && !(existing && (next === genericCompleted || next === genericFailed))) return next;
    if (existing) return existing;
    return status === 'error' ? genericFailed : genericCompleted;
  }

  private upsertToolCall(subagent: SubagentInfo, toolId: string, toolCall: ToolCallInfo): void {
    const existingIndex = subagent.toolCalls.findIndex(tc => tc.id === toolId);
    const existing = subagent.toolCalls[existingIndex];
    if (existing) {
      subagent.toolCalls[existingIndex] = { ...existing, ...toolCall, input: { ...existing.input, ...toolCall.input } };
    } else {
      subagent.toolCalls.push(toolCall);
    }
  }

  private markOrphaned(subagent: SubagentInfo): void {
    subagent.asyncStatus = 'orphaned';
    subagent.status = 'error';
    subagent.result = 'Session ended before task completed';
    subagent.completedAt = Date.now();
    this.onStateChange(subagent);
  }

  private transitionToError(subagent: SubagentInfo, taskToolId: string, errorResult: string, activityStatus?: 'cancelled'): void {
    subagent.asyncStatus = 'error';
    subagent.status = 'error';
    subagent.activityStatus = activityStatus;
    subagent.result = errorResult;
    subagent.completedAt = Date.now();
    this.pendingAsyncSubagents.delete(taskToolId);
    this.onStateChange(subagent);
  }

  private unlinkOutputToolsForAgent(agentId: string): void {
    for (const [toolId, mappedAgentId] of this.outputToolIdToAgentId) {
      if (mappedAgentId === agentId) this.outputToolIdToAgentId.delete(toolId);
    }
  }

  private extractCompletedAsyncToolResult(toolUseResult: unknown): { agentId: string; status: 'completed' | 'error'; activityStatus?: 'cancelled'; result: string } | null {
    if (!toolUseResult || typeof toolUseResult !== 'object' || Array.isArray(toolUseResult)) return null;
    const record = toolUseResult as Record<string, unknown>;
    const agentId = typeof record.agent_id === 'string' ? record.agent_id : typeof record.agentId === 'string' ? record.agentId : null;
    if (!agentId) return null;
    const status = record.status === 'error' ? 'error' : record.status === 'completed' ? 'completed' : null;
    if (!status) return null;
    return {
      agentId,
      status,
      activityStatus: record.activity_status === 'cancelled' ? 'cancelled' : undefined,
      result: typeof record.result === 'string' ? record.result : '',
    };
  }

  private explicitActivityStatus(toolUseResult: unknown): 'cancelled' | undefined {
    if (!toolUseResult || typeof toolUseResult !== 'object' || Array.isArray(toolUseResult)) return undefined;
    return (toolUseResult as Record<string, unknown>).activity_status === 'cancelled'
      ? 'cancelled'
      : undefined;
  }

  private markAsyncActivityStarted(subagent: SubagentInfo): void {
    if (subagent.asyncStatus !== 'pending') return;
    subagent.asyncStatus = 'running';
    subagent.activityStatus = 'running';
    subagent.startedAt ??= Date.now();
    if (subagent.agentId) this.activeAsyncSubagents.set(subagent.agentId, subagent);
  }
}
