import type {
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';
import { TOOL_SPAWN_AGENT, TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import {
  addSubagentToolCall,
  type AsyncSubagentState,
  createAsyncSubagentBlock,
  createSubagentBlock,
  finalizeAsyncSubagent,
  finalizeSubagentBlock,
  formatSubagentTitle,
  markAsyncSubagentOrphaned,
  setSubagentResultText,
  type SubagentRenderContentFn,
  type SubagentState,
  updateAsyncSubagentRunning,
  updateSubagentToolResult,
} from '../rendering/SubagentRenderer';
import type { PendingToolCall } from '../state/types';
import { SubagentResultParser } from './SubagentResultParser';

const defaultTaskResultInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_toolUseResult, fallbackStatus) => fallbackStatus,
  extractTagValue: () => null,
};

export type SubagentStateChangeCallback = (subagent: SubagentInfo) => void;

export type HandleTaskResult =
  | { action: 'buffered' }
  | { action: 'created_sync'; subagentState: SubagentState }
  | { action: 'created_async'; info: SubagentInfo; domState: AsyncSubagentState }
  | { action: 'label_updated' };

export type RenderPendingResult =
  | { mode: 'sync'; subagentState: SubagentState }
  | { mode: 'async'; info: SubagentInfo; domState: AsyncSubagentState };



export class SubagentManager {
  private syncSubagents: Map<string, SubagentState> = new Map();
  private pendingTasks: Map<string, PendingToolCall> = new Map();
  private _spawnedThisStream = 0;

  // Async task state is keyed by the identifier known at each lifecycle phase:
  // pendingAsyncSubagents/domStates by Task tool_use id, activeAsyncSubagents by
  // runtime agent id, and the two bridge maps translate later tool chunks back
  // to the canonical SubagentInfo.
  private activeAsyncSubagents: Map<string, SubagentInfo> = new Map();
  private pendingAsyncSubagents: Map<string, SubagentInfo> = new Map();
  private taskIdToAgentId: Map<string, string> = new Map();
  private outputToolIdToAgentId: Map<string, string> = new Map();
  private asyncDomStates: Map<string, AsyncSubagentState> = new Map();
  private purposeKeyToTaskId: Map<string, string> = new Map();
  private taskIdToWriterName: Map<string, string> = new Map();
  private usedWriterNames: Set<string> = new Set();

  private onStateChange: SubagentStateChangeCallback;
  private taskResultInterpreter: TaskResultInterpreter;
  private parser: SubagentResultParser;
  private renderContent?: SubagentRenderContentFn;

  constructor(
    onStateChange: SubagentStateChangeCallback,
    taskResultInterpreter: TaskResultInterpreter = defaultTaskResultInterpreter,
  ) {
    this.onStateChange = onStateChange;
    this.taskResultInterpreter = taskResultInterpreter;
    this.parser = new SubagentResultParser(taskResultInterpreter);
  }

  public setCallback(callback: SubagentStateChangeCallback): void {
    this.onStateChange = callback;
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

    const existingPurposeTaskId = this.resolveExistingPurposeTaskId(taskToolId, taskInput);
    if (existingPurposeTaskId) {
      const existingPurposeSyncState = this.syncSubagents.get(existingPurposeTaskId);
      if (existingPurposeSyncState) {
        this.updateSubagentLabel(existingPurposeSyncState.wrapperEl, existingPurposeSyncState.info, taskInput);
        return { action: 'label_updated' };
      }
      const existingPurposeAsyncState = this.asyncDomStates.get(existingPurposeTaskId);
      if (existingPurposeAsyncState) {
        this.updateSubagentLabel(existingPurposeAsyncState.wrapperEl, existingPurposeAsyncState.info, taskInput);
        return { action: 'label_updated' };
      }
    }

    // Already buffered → merge input and try to render
    const pending = this.pendingTasks.get(taskToolId);
    if (pending) {
      const newInput = taskInput || {};
      if (Object.keys(newInput).length > 0) {
        pending.toolCall.input = { ...pending.toolCall.input, ...newInput };
      }
      if (currentContentEl) {
        pending.parentEl = currentContentEl;
      }

      // Do not lock mode before run_in_background is explicitly known.
      // Sync fallback is handled when child chunks/tool_result confirm sync.
      if (this.resolveTaskMode(pending.toolCall.input)) {
        const result = this.renderPendingTask(taskToolId, currentContentEl);
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
      const toolCall: ToolCallInfo = {
        id: taskToolId,
        name: TOOL_TASK,
        input: taskInput || {},
        status: 'running',
        isExpanded: false,
      };
      this.pendingTasks.set(taskToolId, { toolCall, parentEl: null });
      return { action: 'buffered' };
    }

    const mode = toolName === TOOL_SPAWN_AGENT
      ? (taskInput.run_in_background === true ? 'async' : 'sync')
      : this.resolveTaskMode(taskInput);
    if (!mode) {
      const toolCall: ToolCallInfo = {
        id: taskToolId,
        name: TOOL_TASK,
        input: taskInput || {},
        status: 'running',
        isExpanded: false,
      };
      this.pendingTasks.set(taskToolId, { toolCall, parentEl: currentContentEl });
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
   * Uses the optional parentEl override, falling back to the stored parentEl.
   */
  public renderPendingTask(
    toolId: string,
    parentElOverride?: HTMLElement | null
  ): RenderPendingResult | null {
    const pending = this.pendingTasks.get(toolId);
    if (!pending) return null;

    const input = pending.toolCall.input;
    const targetEl = parentElOverride ?? pending.parentEl;
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
    const targetEl = parentElOverride ?? pending.parentEl;
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

  public addAsyncToolCall(parentToolUseId: string, toolCall: ToolCallInfo): void {
    const subagentState = this.asyncDomStates.get(parentToolUseId);
    const subagentInfo = this.getByTaskId(parentToolUseId) ?? subagentState?.info;
    if (!subagentState || !subagentInfo) return;

    const existingIndex = subagentInfo.toolCalls.findIndex(tc => tc.id === toolCall.id);
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
    this.updateAsyncDomState(subagentInfo);
    this.onStateChange(subagentInfo);
  }

  public appendSubagentText(parentToolUseId: string, content: string): SubagentInfo | null {
    if (!content) return null;

    const syncState = this.syncSubagents.get(parentToolUseId);
    if (syncState) {
      syncState.info.result = `${syncState.info.result ?? ''}${content}`;
      setSubagentResultText(syncState, syncState.info.result);
      return syncState.info;
    }

    const subagentInfo = this.getByTaskId(parentToolUseId) ?? this.asyncDomStates.get(parentToolUseId)?.info;
    if (!subagentInfo) return null;
    subagentInfo.result = `${subagentInfo.result ?? ''}${content}`;
    this.updateAsyncDomState(subagentInfo);
    this.onStateChange(subagentInfo);
    return subagentInfo;
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
  // Async Subagent Lifecycle
  // ============================================

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
    result?: string
  ): SubagentInfo | undefined {
    const subagent = this.activeAsyncSubagents.get(agentId);
    if (!subagent || subagent.asyncStatus !== 'running') {
      return undefined;
    }

    subagent.agentId = subagent.agentId || agentId;
    subagent.asyncStatus = status;
    subagent.status = status;
    subagent.result = result?.trim() || (status === 'error' ? 'Background task failed.' : 'Background task completed.');
    subagent.completedAt = Date.now();

    this.activeAsyncSubagents.delete(agentId);
    this.unlinkOutputToolsForAgent(agentId);

    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
    return subagent;
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

    const agentId = this.taskIdToAgentId.get(taskToolId);
    if (agentId) {
      return this.activeAsyncSubagents.get(agentId);
    }

    return undefined;
  }

  /**
   * Re-renders an async subagent after data-only updates (for example,
   * hydrating tool calls from SDK sidecar files) without changing lifecycle state.
   */
  public refreshAsyncSubagent(subagent: SubagentInfo): void {
    this.updateAsyncDomState(subagent);
    this.onStateChange(subagent);
  }

  // ============================================
  // Hook State
  // ============================================

  public hasRunningSubagents(): boolean {
    // pendingAsyncSubagents: awaiting agent_id; activeAsyncSubagents: only holds running entries
    return this.pendingAsyncSubagents.size > 0 || this.activeAsyncSubagents.size > 0;
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
    this.purposeKeyToTaskId.clear();
    this.taskIdToWriterName.clear();
    this.usedWriterNames.clear();

    return orphaned;
  }

  public clear(): void {
    this.syncSubagents.clear();
    this.pendingTasks.clear();
    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();
    this.asyncDomStates.clear();
    this.purposeKeyToTaskId.clear();
    this.taskIdToWriterName.clear();
    this.usedWriterNames.clear();
  }

  // ============================================
  // Private: State Transitions
  // ============================================

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

  // ============================================
  // Private: Task Creation
  // ============================================

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
    this.rememberPurpose(taskToolId, taskInput);
    return { action: 'created_sync', subagentState };
  }

  private createAsyncTask(
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
      renderContent: this.renderContent,
      writerName: info.writerName,
    });
    this.asyncDomStates.set(taskToolId, domState);
    this.rememberPurpose(taskToolId, taskInput);

    return { action: 'created_async', info, domState };
  }

  // ============================================
  // Private: Label Update
  // ============================================

  private updateSubagentLabel(
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
        summaryEl.setText('Waiting for subagent activity');
      }
    }
    const prompt = (newInput.message as string) || (newInput.prompt as string) || '';
    if (prompt) {
      info.prompt = prompt;
      const promptEl = wrapperEl.querySelector('.pivi-subagent-prompt-text');
      if (promptEl) {
        promptEl.setText(prompt);
      }
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

  private extractPurposeKey(input: Record<string, unknown>): string | null {
    const label = (input.label as string | undefined)?.trim()
      || (input.description as string | undefined)?.trim();
    if (!label) return null;
    return label.toLowerCase().replace(/\s+/g, ' ');
  }

  private rememberPurpose(taskToolId: string, input: Record<string, unknown>): void {
    const purposeKey = this.extractPurposeKey(input);
    if (purposeKey) {
      this.purposeKeyToTaskId.set(purposeKey, taskToolId);
    }
  }

  private resolveExistingPurposeTaskId(
    taskToolId: string,
    input: Record<string, unknown>,
  ): string | null {
    const purposeKey = this.extractPurposeKey(input);
    if (!purposeKey) return null;
    const existingTaskId = this.purposeKeyToTaskId.get(purposeKey);
    return existingTaskId && existingTaskId !== taskToolId ? existingTaskId : null;
  }

  private assignWriterName(taskToolId: string): string {
    const existing = this.taskIdToWriterName.get(taskToolId);
    if (existing) return existing;

    const writerNames = [
      'Austen',
      'Baldwin',
      'Borges',
      'Brontë',
      'Calvino',
      'Dostoevsky',
      'Eliot',
      'Homer',
      'Kafka',
      'Le Guin',
      'Morrison',
      'Murakami',
      'Neruda',
      'Sappho',
      'Tolstoy',
      'Woolf',
    ];
    for (const writerName of writerNames) {
      if (!this.usedWriterNames.has(writerName)) {
        this.usedWriterNames.add(writerName);
        this.taskIdToWriterName.set(taskToolId, writerName);
        return writerName;
      }
    }

    const fallback = `${writerNames[this.usedWriterNames.size % writerNames.length]} ${Math.floor(this.usedWriterNames.size / writerNames.length) + 1}`;
    this.usedWriterNames.add(fallback);
    this.taskIdToWriterName.set(taskToolId, fallback);
    return fallback;
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

  // ============================================
  // Private: Async DOM State Updates
  // ============================================

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
        updateAsyncSubagentRunning(asyncState, subagent.agentId || '');
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
