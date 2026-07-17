import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';
import { TOOL_SPAWN_AGENT, TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import { SUBAGENT_WRITER_NAMES } from '../subagentProfiles';
import { SubagentAsyncManagerBase } from './SubagentAsyncManagerBase';
import type { HandleTaskResult, RenderPendingResult, SubagentStateChangeCallback } from './subagentManagerTypes';
import { SubagentResultParser } from './SubagentResultParser';

export type { HandleTaskResult, RenderPendingResult, SubagentStateChangeCallback } from './subagentManagerTypes';

interface PendingTask {
  toolCall: ToolCallInfo;
}

const defaultTaskResultInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_toolUseResult, fallbackStatus) => fallbackStatus,
  extractTagValue: () => null,
};

/** Coordinates subagent lifecycle records without owning presentation nodes. */
export class SubagentManager extends SubagentAsyncManagerBase {
  private syncSubagents = new Map<string, SubagentInfo>();
  private pendingTasks = new Map<string, PendingTask>();
  private _spawnedThisStream = 0;
  private taskIdToWriterName = new Map<string, string>();
  private usedWriterNames = new Set<string>();

  constructor(
    onStateChange: SubagentStateChangeCallback,
    taskResultInterpreter: TaskResultInterpreter = defaultTaskResultInterpreter,
  ) {
    super(onStateChange, taskResultInterpreter, new SubagentResultParser(taskResultInterpreter));
  }

  public setCallback(callback: SubagentStateChangeCallback): void {
    this.setStateChangeCallback(callback);
  }

  /** Handles Task tool_use with buffering until its sync/async mode is known. */
  public handleTaskToolUse(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    toolName: string = TOOL_TASK,
  ): HandleTaskResult {
    const existing = this.syncSubagents.get(taskToolId) ?? this.getByTaskId(taskToolId);
    if (existing) {
      this.updateSubagentInput(existing, taskInput);
      this.onStateChange(existing);
      return { action: 'label_updated', info: existing };
    }

    const pending = this.pendingTasks.get(taskToolId);
    if (pending) {
      if (Object.keys(taskInput).length > 0) {
        pending.toolCall.input = { ...pending.toolCall.input, ...taskInput };
      }
      if (this.resolveTaskMode(pending.toolCall.input)) {
        const resolved = this.renderPendingTask(taskToolId);
        if (resolved) return resolved.mode === 'sync'
          ? { action: 'created_sync', info: resolved.info }
          : { action: 'created_async', info: resolved.info };
      }
      return { action: 'buffered' };
    }

    const mode = toolName === TOOL_SPAWN_AGENT
      ? (taskInput.run_in_background === true ? 'async' : 'sync')
      : this.resolveTaskMode(taskInput);
    if (!mode) {
      this.bufferPendingTask(taskToolId, taskInput, toolName);
      return { action: 'buffered' };
    }

    return this.createTask(taskToolId, taskInput, mode);
  }

  public hasPendingTask(toolId: string): boolean {
    return this.pendingTasks.has(toolId);
  }

  /** Resolves a buffered task once a mode has been established. */
  public renderPendingTask(toolId: string): RenderPendingResult | null {
    const pending = this.pendingTasks.get(toolId);
    if (!pending) return null;
    const mode = this.resolveTaskMode(pending.toolCall.input);
    if (!mode) return null;
    this.pendingTasks.delete(toolId);
    const result = this.createTask(pending.toolCall.id, pending.toolCall.input, mode);
    return result.action === 'buffered' || result.action === 'label_updated'
      ? null
      : { mode: result.action === 'created_async' ? 'async' : 'sync', info: result.info };
  }

  /** Resolves a buffered task from its tool_result, defaulting unknown mode to sync. */
  public renderPendingTaskFromTaskResult(
    toolId: string,
    taskResult: unknown,
    isError: boolean,
    taskToolUseResult?: unknown,
  ): RenderPendingResult | null {
    const pending = this.pendingTasks.get(toolId);
    if (!pending) return null;
    const taskResultText = extractToolResultContent(taskResult, { fallbackIndent: 2 });
    const mode = this.resolveTaskMode(pending.toolCall.input)
      ?? this.inferModeFromTaskResult(taskResultText, isError, taskToolUseResult);
    this.pendingTasks.delete(toolId);
    const result = this.createTask(pending.toolCall.id, pending.toolCall.input, mode);
    return result.action === 'buffered' || result.action === 'label_updated'
      ? null
      : { mode: result.action === 'created_async' ? 'async' : 'sync', info: result.info };
  }

  public getSyncSubagent(toolId: string): SubagentInfo | undefined {
    return this.syncSubagents.get(toolId);
  }

  public addSyncToolCall(parentToolUseId: string, toolCall: ToolCallInfo): void {
    const subagent = this.syncSubagents.get(parentToolUseId);
    if (!subagent) return;
    this.upsertSyncToolCall(subagent, toolCall.id, toolCall);
    this.onStateChange(subagent);
  }

  public updateSyncToolResult(parentToolUseId: string, toolId: string, toolCall: ToolCallInfo): void {
    const subagent = this.syncSubagents.get(parentToolUseId);
    if (!subagent) return;
    this.upsertSyncToolCall(subagent, toolId, toolCall);
    this.onStateChange(subagent);
  }

  public appendSubagentText(parentToolUseId: string, content: string): SubagentInfo | null {
    if (!content) return null;
    const subagent = this.syncSubagents.get(parentToolUseId);
    if (!subagent) return this.appendAsyncSubagentText(parentToolUseId, content);
    subagent.result = `${subagent.result ?? ''}${content}`;
    this.onStateChange(subagent);
    return subagent;
  }

  public finalizeSyncSubagent(toolId: string, result: unknown, isError: boolean, toolUseResult?: unknown): SubagentInfo | null {
    const subagent = this.syncSubagents.get(toolId);
    if (!subagent) return null;
    const resultText = extractToolResultContent(result, { fallbackIndent: 2 });
    subagent.result = this.parser.extractAgentResult(resultText, '', toolUseResult);
    subagent.status = isError ? 'error' : 'completed';
    subagent.completedAt = Date.now();
    this.onStateChange(subagent);
    return subagent;
  }

  public get subagentsSpawnedThisStream(): number {
    return this._spawnedThisStream;
  }

  public resetSpawnedCount(): void {
    this._spawnedThisStream = 0;
  }

  public resetStreamingState(): void {
    this.syncSubagents.clear();
    this.pendingTasks.clear();
  }

  public orphanAllActive(): SubagentInfo[] {
    const orphaned = super.orphanAllActive();
    for (const subagent of this.syncSubagents.values()) {
      if (subagent.status === 'running') {
        this.markOrphaned(subagent);
        orphaned.push(subagent);
      }
    }
    this.syncSubagents.clear();
    this.taskIdToWriterName.clear();
    this.usedWriterNames.clear();
    return orphaned;
  }

  public clear(): void {
    this.syncSubagents.clear();
    this.pendingTasks.clear();
    this.clearAsyncState();
    this.taskIdToWriterName.clear();
    this.usedWriterNames.clear();
  }

  protected assignWriterName(taskToolId: string): string {
    const existing = this.taskIdToWriterName.get(taskToolId);
    if (existing) return existing;
    for (const writerName of SUBAGENT_WRITER_NAMES) {
      if (!this.usedWriterNames.has(writerName)) {
        this.usedWriterNames.add(writerName);
        this.taskIdToWriterName.set(taskToolId, writerName);
        return writerName;
      }
    }
    const fallback = `${SUBAGENT_WRITER_NAMES[this.usedWriterNames.size % SUBAGENT_WRITER_NAMES.length]} ${Math.floor(this.usedWriterNames.size / SUBAGENT_WRITER_NAMES.length) + 1}`;
    this.usedWriterNames.add(fallback);
    this.taskIdToWriterName.set(taskToolId, fallback);
    return fallback;
  }

  private createTask(taskToolId: string, taskInput: Record<string, unknown>, mode: 'sync' | 'async'): HandleTaskResult {
    this._spawnedThisStream++;
    if (mode === 'async') return { action: 'created_async', info: this.createAsyncTask(taskToolId, taskInput) };
    const existing = this.syncSubagents.get(taskToolId);
    if (existing) {
      this.updateSubagentInput(existing, taskInput);
      return { action: 'created_sync', info: existing };
    }
    const info: SubagentInfo = {
      id: taskToolId,
      writerName: this.assignWriterName(taskToolId),
      description: this.descriptionFromInput(taskInput),
      prompt: this.promptFromInput(taskInput),
      mode: 'sync',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
    };
    this.syncSubagents.set(taskToolId, info);
    return { action: 'created_sync', info };
  }

  private bufferPendingTask(taskToolId: string, taskInput: Record<string, unknown>, toolName: string): void {
    this.pendingTasks.set(taskToolId, {
      toolCall: { id: taskToolId, name: toolName, input: taskInput || {}, status: 'running', isExpanded: false },
    });
  }

  private resolveTaskMode(taskInput: Record<string, unknown>): 'sync' | 'async' | null {
    if (!Object.prototype.hasOwnProperty.call(taskInput, 'run_in_background')) return null;
    if (taskInput.run_in_background === true) return 'async';
    if (taskInput.run_in_background === false) return 'sync';
    return null;
  }

  private inferModeFromTaskResult(taskResult: string, isError: boolean, taskToolUseResult?: unknown): 'sync' | 'async' {
    if (isError) return 'sync';
    if (this.taskResultInterpreter.hasAsyncLaunchMarker(taskToolUseResult)) return 'async';
    return this.parser.extractAgentId(taskResult) ? 'async' : 'sync';
  }

  private upsertSyncToolCall(subagent: SubagentInfo, toolId: string, toolCall: ToolCallInfo): void {
    const index = subagent.toolCalls.findIndex(tc => tc.id === toolId);
    const existing = subagent.toolCalls[index];
    if (existing) {
      subagent.toolCalls[index] = { ...existing, ...toolCall, input: { ...existing.input, ...toolCall.input } };
    } else {
      subagent.toolCalls.push(toolCall);
    }
  }
}
