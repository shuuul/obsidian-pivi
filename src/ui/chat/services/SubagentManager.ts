import type {
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';
import { TOOL_SPAWN_AGENT, TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import { t } from '@/i18n';

import {
  addSubagentToolCall,
  createSubagentBlock,
  finalizeSubagentBlock,
  setSubagentResultText,
  type SubagentState,
  updateSubagentToolResult,
} from '../rendering/SubagentRenderer';
import {
  formatSubagentTitle,
  type SubagentRenderContentFn,
} from '../rendering/subagentRendererShared';
import type { PendingToolCall } from '../state/types';
import { SUBAGENT_WRITER_NAMES } from '../subagentProfiles';
import { SubagentAsyncManagerBase } from './SubagentAsyncManagerBase';
import type {
  HandleTaskResult,
  RenderPendingResult,
  SubagentStateChangeCallback,
} from './subagentManagerTypes';
import { SubagentResultParser } from './SubagentResultParser';

export type {
  HandleTaskResult,
  RenderPendingResult,
  SubagentStateChangeCallback,
} from './subagentManagerTypes';

const defaultTaskResultInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_toolUseResult, fallbackStatus) => fallbackStatus,
  extractTagValue: () => null,
};

export class SubagentManager extends SubagentAsyncManagerBase {
  private syncSubagents: Map<string, SubagentState> = new Map();
  private pendingTasks: Map<string, PendingToolCall> = new Map();
  private _spawnedThisStream = 0;
  private taskIdToWriterName: Map<string, string> = new Map();
  private usedWriterNames: Set<string> = new Set();
  private renderContent?: SubagentRenderContentFn;

  constructor(
    onStateChange: SubagentStateChangeCallback,
    taskResultInterpreter: TaskResultInterpreter = defaultTaskResultInterpreter,
  ) {
    super(
      onStateChange,
      taskResultInterpreter,
      new SubagentResultParser(taskResultInterpreter),
    );
  }

  public setCallback(callback: SubagentStateChangeCallback): void {
    this.setStateChangeCallback(callback);
  }

  public setRenderContent(renderContent: SubagentRenderContentFn): void {
    this.renderContent = renderContent;
  }

  // ============================================
  // Unified Subagent Entry Point
  // ============================================

  /**
   * Handles an Agent tool_use chunk with minimal buffering to determine sync vs async.
   * Returns a typed result so StreamController can update messages accordingly.
   */
  public handleTaskToolUse(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    currentContentEl: HTMLElement | null,
    toolName: string = TOOL_TASK,
  ): HandleTaskResult {
    // Already rendered as sync → update label (no parentEl needed)
    const existingSyncState = this.syncSubagents.get(taskToolId);
    if (existingSyncState) {
      this.updateSubagentLabel(existingSyncState.wrapperEl, existingSyncState.info, taskInput);
      return { action: 'label_updated' };
    }

    // Already rendered as async → update label (no parentEl needed)
    const existingAsyncState = this.asyncDomStates.get(taskToolId);
    if (existingAsyncState) {
      this.updateSubagentLabel(existingAsyncState.wrapperEl, existingAsyncState.info, taskInput);
      // Sync to canonical SubagentInfo so status transitions don't revert updates
      const canonical = this.getByTaskId(taskToolId);
      if (canonical && canonical !== existingAsyncState.info) {
        if (taskInput.description) canonical.description = taskInput.description as string;
        if (taskInput.prompt) canonical.prompt = taskInput.prompt as string;
      }
      return { action: 'label_updated' };
    }

    // Already buffered → merge input and try to render
    const pending = this.pendingTasks.get(taskToolId);
    if (pending) {
      const newInput = taskInput || {};
      if (Object.keys(newInput).length > 0) {
        pending.toolCall.input = { ...pending.toolCall.input, ...newInput };
      }
      if (!pending.parentEl && currentContentEl) {
        pending.parentEl = currentContentEl;
      }

      // Do not lock mode before run_in_background is explicitly known.
      // Sync fallback is handled when child chunks/tool_result confirm sync.
      if (this.resolveTaskMode(pending.toolCall.input)) {
        const result = this.renderPendingTask(taskToolId);
        if (result) {
          return result.mode === 'sync'
            ? { action: 'created_sync', subagentState: result.subagentState }
            : { action: 'created_async', info: result.info, domState: result.domState };
        }
      }
      return { action: 'buffered' };
    }

    // New Task without a content element — buffer for later rendering
    if (!currentContentEl) {
      this.bufferPendingTask(taskToolId, taskInput, null);
      return { action: 'buffered' };
    }

    const mode = toolName === TOOL_SPAWN_AGENT
      ? (taskInput.run_in_background === true ? 'async' : 'sync')
      : this.resolveTaskMode(taskInput);
    if (!mode) {
      this.bufferPendingTask(taskToolId, taskInput, currentContentEl);
      return { action: 'buffered' };
    }

    this._spawnedThisStream++;
    if (mode === 'async') {
      return this.createAsyncTask(taskToolId, taskInput, currentContentEl);
    }
    return this.createSyncTask(taskToolId, taskInput, currentContentEl);
  }

  // ============================================
  // Pending Task Resolution
  // ============================================

  public hasPendingTask(toolId: string): boolean {
    return this.pendingTasks.has(toolId);
  }

  /**
   * Renders a buffered pending task. Called when a child chunk or tool_result
   * confirms the task is sync, or when run_in_background becomes known.
   * Uses the original stored parentEl, falling back to the optional parentEl
   * only when the task was first buffered before a render anchor existed.
   */
  public renderPendingTask(
    toolId: string,
    parentElOverride?: HTMLElement | null
  ): RenderPendingResult | null {
    const pending = this.pendingTasks.get(toolId);
    if (!pending) return null;

    const input = pending.toolCall.input;
    const targetEl = pending.parentEl ?? parentElOverride;
    if (!targetEl) return null;

    this.pendingTasks.delete(toolId);

    try {
      if (input.run_in_background === true) {
        const result = this.createAsyncTask(pending.toolCall.id, input, targetEl);
        if (result.action === 'created_async') {
          this._spawnedThisStream++;
          return { mode: 'async', info: result.info, domState: result.domState };
        }
      } else {
        const result = this.createSyncTask(pending.toolCall.id, input, targetEl);
        if (result.action === 'created_sync') {
          this._spawnedThisStream++;
          return { mode: 'sync', subagentState: result.subagentState };
        }
      }
    } catch {
      // Non-fatal: task appears incomplete but doesn't crash the stream
    }

    return null;
  }

  /**
   * Resolves a pending Task when its own tool_result arrives.
   * If mode is still unknown, infer async from task result shape (agent_id/agentId),
   * otherwise fall back to sync so it never remains pending indefinitely.
   */
  public renderPendingTaskFromTaskResult(
    toolId: string,
    taskResult: unknown,
    isError: boolean,
    parentElOverride?: HTMLElement | null,
    taskToolUseResult?: unknown
  ): RenderPendingResult | null {
    const pending = this.pendingTasks.get(toolId);
    if (!pending) return null;

    const input = pending.toolCall.input;
    const targetEl = pending.parentEl ?? parentElOverride;
    if (!targetEl) return null;

    const explicitMode = this.resolveTaskMode(input);
    const taskResultText = extractToolResultContent(taskResult, { fallbackIndent: 2 });
    const inferredMode = explicitMode
      ?? this.inferModeFromTaskResult(taskResultText, isError, taskToolUseResult);

    this.pendingTasks.delete(toolId);

    try {
      if (inferredMode === 'async') {
        const result = this.createAsyncTask(pending.toolCall.id, input, targetEl);
        if (result.action === 'created_async') {
          this._spawnedThisStream++;
          return { mode: 'async', info: result.info, domState: result.domState };
        }
      } else {
        const result = this.createSyncTask(pending.toolCall.id, input, targetEl);
        if (result.action === 'created_sync') {
          this._spawnedThisStream++;
          return { mode: 'sync', subagentState: result.subagentState };
        }
      }
    } catch {
      // Non-fatal: task appears incomplete but doesn't crash the stream
    }

    return null;
  }

  // ============================================
  // Sync Subagent Operations
  // ============================================

  public getSyncSubagent(toolId: string): SubagentState | undefined {
    return this.syncSubagents.get(toolId);
  }

  public addSyncToolCall(parentToolUseId: string, toolCall: ToolCallInfo): void {
    const subagentState = this.syncSubagents.get(parentToolUseId);
    if (!subagentState) return;
    addSubagentToolCall(subagentState, toolCall);
  }

  public updateSyncToolResult(
    parentToolUseId: string,
    toolId: string,
    toolCall: ToolCallInfo
  ): void {
    const subagentState = this.syncSubagents.get(parentToolUseId);
    if (!subagentState) return;
    updateSubagentToolResult(subagentState, toolId, toolCall);
  }

  public appendSubagentText(parentToolUseId: string, content: string): SubagentInfo | null {
    if (!content) return null;

    const syncState = this.syncSubagents.get(parentToolUseId);
    if (syncState) {
      syncState.info.result = `${syncState.info.result ?? ''}${content}`;
      setSubagentResultText(syncState, syncState.info.result);
      return syncState.info;
    }

    return this.appendAsyncSubagentText(parentToolUseId, content);
  }

  public finalizeSyncSubagent(
    toolId: string,
    result: unknown,
    isError: boolean,
    toolUseResult?: unknown
  ): SubagentInfo | null {
    const subagentState = this.syncSubagents.get(toolId);
    if (!subagentState) return null;

    const resultText = extractToolResultContent(result, { fallbackIndent: 2 });
    const extractedResult = this.parser.extractAgentResult(resultText, '', toolUseResult);
    finalizeSubagentBlock(subagentState, extractedResult, isError);

    return subagentState.info;
  }

  // ============================================
  // Lifecycle
  // ============================================

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

  // ============================================
  // Private: Task Creation
  // ============================================

  private bufferPendingTask(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    parentEl: HTMLElement | null,
  ): void {
    this.pendingTasks.set(taskToolId, {
      toolCall: {
        id: taskToolId,
        name: TOOL_TASK,
        input: taskInput || {},
        status: 'running',
        isExpanded: false,
      },
      parentEl,
    });
  }

  private createSyncTask(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    parentEl: HTMLElement
  ): HandleTaskResult {
    const existingSyncState = this.syncSubagents.get(taskToolId);
    if (existingSyncState) {
      this.updateSubagentLabel(existingSyncState.wrapperEl, existingSyncState.info, taskInput);
      return { action: 'created_sync', subagentState: existingSyncState };
    }
    const subagentState = createSubagentBlock(parentEl, taskToolId, taskInput, {
      renderContent: this.renderContent,
      writerName: this.assignWriterName(taskToolId),
    });
    this.syncSubagents.set(taskToolId, subagentState);
    return { action: 'created_sync', subagentState };
  }

  // ============================================
  // Private: Label Update
  // ============================================

  protected updateSubagentLabel(
    wrapperEl: HTMLElement,
    info: SubagentInfo,
    newInput: Record<string, unknown>
  ): void {
    if (!newInput || Object.keys(newInput).length === 0) return;
    const description = (newInput.label as string) || (newInput.description as string) || '';
    if (description) {
      info.description = description;
      const labelEl = wrapperEl.querySelector('.pivi-subagent-label');
      if (labelEl) {
        labelEl.setText(formatSubagentTitle(info.id, description, info.writerName));
      }
      const summaryEl = wrapperEl.querySelector('.pivi-subagent-step-summary');
      if (summaryEl) {
        summaryEl.setText(t('chat.stream.waitingSubagent'));
      }
    }
    const prompt = (newInput.message as string) || (newInput.prompt as string) || '';
    if (prompt) {
      info.prompt = prompt;
    }
  }

  private resolveTaskMode(taskInput: Record<string, unknown>): 'sync' | 'async' | null {
    if (!Object.prototype.hasOwnProperty.call(taskInput, 'run_in_background')) {
      return null;
    }
    if (taskInput.run_in_background === true) {
      return 'async';
    }
    if (taskInput.run_in_background === false) {
      return 'sync';
    }
    return null;
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

  private inferModeFromTaskResult(
    taskResult: string,
    isError: boolean,
    taskToolUseResult?: unknown
  ): 'sync' | 'async' {
    if (isError) {
      return 'sync';
    }
    if (this.taskResultInterpreter.hasAsyncLaunchMarker(taskToolUseResult)) {
      return 'async';
    }
    // Only promote to async for launch-shaped payloads. Completed sync results
    // can still contain agent metadata in the payload or final output text.
    return this.parseAgentIdStrict(taskResult) ? 'async' : 'sync';
  }

  private parseAgentIdStrict(result: string): string | null {
    return this.parser.extractAgentId(result);
  }

  protected getSubagentRenderContent(): SubagentRenderContentFn | undefined {
    return this.renderContent;
  }
}
