import { TFile } from 'obsidian';

import type PiviPlugin from '../../../main';
import type { SubagentLifecycleAdapter } from '../../../pi/agent/types';
import type { ChatRuntime } from '../../../pi/runtime/ChatRuntime';
import {
  isSubagentToolName,
  TOOL_TASK,
} from '../../../pi/tools/toolNames';
import { extractToolResultContent } from '../../../pi/tools/toolResultContent';
import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo } from '../../../pi/types';
import type { ToolUseResult } from '../../../pi/types/diff';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { formatDurationMmSs } from '../../../utils/date';
import { hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import { getVaultPath, normalizePathForVault } from '../../../utils/path';
import { FLAVOR_TEXTS } from '../constants';
import {
  stripLeadingWhitespaceForNewTextBlock,
  trimEmptyEdgeParagraphs,
} from '../rendering/markdownContentCleanup';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
import {
  cleanupThinkingBlock,
  createThinkingBlock,
  finalizeThinkingBlock,
} from '../rendering/ThinkingBlockRenderer';
import {
  isBlockedToolResult,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import { PendingToolRendering } from './pendingToolRendering';
import { handleRegularToolResult } from './regularToolResultHandling';
import { resolveActiveChatModel } from './streamActiveModel';
import {
  registerMessageToolCall,
} from './streamMessageUpdates';
import { StreamRenderQueue } from './streamRenderQueue';
import { applySubagentLifecycleToolResult } from './streamSubagentLifecycle';
import { routeToolUseStreamChunk } from './streamToolUseRouting';
import { shouldApplyUsageStreamChunk } from './streamUsageFilter';

export interface StreamControllerDeps {
  plugin: PiviPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => ChatRuntime | null;
}

export class StreamController {
  private static readonly ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

  private deps: StreamControllerDeps;
  private textRenderSnapshotEl: HTMLElement | null = null;
  private textRenderSnapshotContent = '';
  private thinkingRenderSnapshot: { el: HTMLElement; content: string } | null = null;
  private readonly textRenderQueue: StreamRenderQueue;
  private readonly thinkingRenderQueue: StreamRenderQueue;
  private readonly pendingToolRendering: PendingToolRendering;
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;

  // Subagent lifecycle tracking (spawn → wait/close)
  private lifecycleSubagentStates = new Map<string, SubagentState>(); // spawn callId → SubagentState
  private lifecycleAgentIdToSpawnId = new Map<string, string>();      // agentId → spawn callId

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
    this.textRenderQueue = new StreamRenderQueue(
      () => this.getStreamingRenderWindow() ?? undefined,
      () => this.executeTextRender(),
      () => this.hasPendingTextUpdates(),
    );
    this.thinkingRenderQueue = new StreamRenderQueue(
      () => this.getThinkingRenderWindow() ?? undefined,
      () => this.executeThinkingRender(),
      () => this.hasPendingThinkingUpdates(),
    );
    this.pendingToolRendering = new PendingToolRendering({
      state: deps.state,
      capturePlanFilePath: (input) => this.capturePlanFilePath(input),
      showThinkingIndicator: () => this.showThinkingIndicator(),
      scheduleToolOutputRender: (toolId, toolCall) => this.scheduleToolOutputRender(toolId, toolCall),
    });
  }

  private getSubagentLifecycleAdapter(toolName?: string): SubagentLifecycleAdapter | null {
    return resolveSubagentLifecycleAdapter(toolName);
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleStreamChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    switch (chunk.type) {
      case 'thinking':
        await this.handleThinkingChunk(chunk, msg);
        break;

      case 'text':
        await this.handleTextChunk(chunk, msg);
        break;

      case 'tool_use':
        await this.handleToolUseChunk(chunk, msg);
        break;

      case 'tool_result':
        await this.handleToolResult(chunk, msg);
        break;

      case 'subagent_tool_use':
      case 'subagent_tool_result':
        await this.handleSubagentChunk(chunk, msg);
        break;

      case 'async_subagent_result':
        await this.handleAsyncSubagentResult(chunk);
        break;

      case 'tool_output':
        this.handleToolOutput(chunk, msg);
        break;

      case 'notice':
        await this.handleNoticeChunk(chunk);
        break;

      case 'error':
        await this.handleErrorChunk(chunk);
        break;

      case 'done':
        // Flush any remaining pending tools
        this.flushPendingTools();
        break;

      case 'context_compacted':
        await this.handleContextCompactedChunk(msg);
        break;

      case 'usage':
        this.handleUsageChunk(chunk);
        break;

      default:
        break;
    }

    this.scrollToBottom();
  }

  private async handleThinkingChunk(
    chunk: Extract<StreamChunk, { type: 'thinking' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const { state } = this.deps;
    // Flush pending tools before rendering new content type
    this.flushPendingTools();
    if (state.currentTextEl) {
      await this.finalizeCurrentTextBlock(msg);
    }
    await this.appendThinking(chunk.content);
  }

  private async handleTextChunk(
    chunk: Extract<StreamChunk, { type: 'text' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const { state } = this.deps;
    // Flush pending tools before rendering new content type
    this.flushPendingTools();
    if (state.currentThinkingState) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    msg.content += chunk.content;
    await this.appendText(chunk.content);
  }

  private async handleToolUseChunk(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const { state } = this.deps;
    if (state.currentThinkingState) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    await this.finalizeCurrentTextBlock(msg);
    this.hideThinkingIndicator();

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(chunk.name);
    switch (routeToolUseStreamChunk(chunk.name, subagentLifecycleAdapter)) {
      case 'subagent_task':
        this.flushPendingTools();
        this.handleTaskToolUseViaManager(chunk, msg);
        break;
      case 'agent_output':
        this.handleAgentOutputToolUse(chunk, msg);
        break;
      case 'subagent_spawn':
        if (subagentLifecycleAdapter) {
          this.handleSubagentSpawn(chunk, msg, subagentLifecycleAdapter);
        }
        break;
      case 'subagent_hidden':
        this.handleHiddenSubagentTool(chunk, msg);
        break;
      case 'regular':
        this.handleRegularToolUse(chunk, msg);
        break;
    }
  }

  private async handleNoticeChunk(chunk: Extract<StreamChunk, { type: 'notice' }>): Promise<void> {
    this.flushPendingTools();
    await this.appendText(`\n\n⚠️ **${chunk.level === 'warning' ? 'Blocked' : 'Notice'}:** ${chunk.content}`);
  }

  private async handleErrorChunk(chunk: Extract<StreamChunk, { type: 'error' }>): Promise<void> {
    // Flush pending tools before rendering error message
    this.flushPendingTools();
    await this.appendText(`\n\n❌ **Error:** ${chunk.content}`);
  }

  private async handleContextCompactedChunk(msg: ChatMessage): Promise<void> {
    const { state } = this.deps;
    this.flushPendingTools();
    if (state.currentThinkingState) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    await this.finalizeCurrentTextBlock(msg);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'context_compacted' });
    this.renderCompactBoundary();
  }

  private handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    const { state } = this.deps;
    const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
    if (!shouldApplyUsageStreamChunk({
      chunkSessionId: chunk.sessionId ?? null,
      currentSessionId,
      subagentsSpawnedThisStream: this.deps.subagentManager.subagentsSpawnedThisStream,
      ignoreUsageUpdates: state.ignoreUsageUpdates,
    })) {
      return;
    }
    const activeModel = this.getActiveChatModel();
    state.usage = activeModel && !chunk.usage.model
      ? { ...chunk.usage, model: activeModel }
      : chunk.usage;
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Handles regular tool_use chunks by buffering them.
   * Tools are rendered when flushPendingTools is called (on next content type or tool_result).
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    this.pendingToolRendering.handleRegularToolUse(chunk, msg);
  }

  private getActiveChatModel(): string | undefined {
    return resolveActiveChatModel(this.deps.plugin, this.deps.getAgentService);
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private getStreamingRenderOptions(content: string): RenderContentOptions | undefined {
    return this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content)
      ? { deferMath: true }
      : undefined;
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    void input;
  }

  /**
   * Flushes all pending tool calls by rendering them.
   * Called when a different content type arrives or stream ends.
   */
  private flushPendingTools(): void {
    this.pendingToolRendering.flushPendingTools();
  }

  /**
   * Renders a single pending tool call and moves it from pending to rendered state.
   */
  private renderPendingTool(toolId: string): void {
    this.pendingToolRendering.renderPendingTool(toolId);
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    this.pendingToolRendering.handleToolOutput(chunk, msg);
  }

  // ============================================
  // Subagent spawn / wait / close handling
  // ============================================

  private handleSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: SubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;

    const toolCall = registerMessageToolCall(msg, chunk, { contentBlock: true });

    // Render as subagent block immediately
    if (state.currentContentEl) {
      this.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);

      const subagentState = createSubagentBlock(state.currentContentEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
  }

  private handleHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    registerMessageToolCall(msg, chunk, { contentBlock: false });
  }

  /**
   * Handles tool_result for provider lifecycle subagent tools.
   * Returns true if the result was consumed (caller should return early).
   */
  private handleSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage
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

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: ToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state, subagentManager } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    // Resolve pending Task before processing result.
    if (subagentManager.hasPendingTask(chunk.id)) {
      this.renderPendingTaskFromTaskResultViaManager(chunk, msg);
    }

    // Check if it's a sync subagent result
    const subagentState = subagentManager.getSyncSubagent(chunk.id);
    if (subagentState) {
      this.finalizeSubagent(chunk, msg);
      return;
    }

    // Check if it's an async task result
    if (this.handleAsyncTaskToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if it's an agent output result
    if (await this.handleAgentOutputToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (this.handleSubagentResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    handleRegularToolResult({
      state,
      renderPendingTool: (toolId) => this.renderPendingTool(toolId),
      cancelPendingToolOutputRender: (toolId) => this.cancelPendingToolOutputRender(toolId),
      notifyVaultFileChange: (input) => this.notifyVaultFileChange(input),
      notifyObsidianVaultPathChange: (input) => this.notifyObsidianVaultPathChange(input),
      notifyApplyPatchFileChanges: (input) => this.notifyApplyPatchFileChanges(input),
      showThinkingIndicator: () => this.showThinkingIndicator(),
    }, chunk, msg, normalizedContent);
  }

  // ============================================
  // Text Block Management
  // ============================================

  appendText(text: string): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return Promise.resolve();

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      const stripped = stripLeadingWhitespaceForNewTextBlock(text);
      if (!stripped) {
        return Promise.resolve();
      }
      text = stripped;
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'pivi-text-block' });
      state.currentTextContent = '';
    }

    state.currentTextContent += text;
    void this.scheduleCurrentTextRender();
    return Promise.resolve();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.flushPendingTextRender();

    const textContent = state.currentTextContent ?? '';
    const hasVisibleText = textContent.trim().length > 0;

    if (msg && hasVisibleText) {
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(textContent)
      ) {
        await renderer.renderContent(state.currentTextEl, textContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: textContent });
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl) {
        renderer.addTextCopyButton(state.currentTextEl, textContent);
      }
    } else if (state.currentTextEl?.isConnected) {
      state.currentTextEl.remove();
    }

    state.currentTextEl = null;
    state.currentTextContent = '';
  }

  private scheduleCurrentTextRender(): Promise<void> {
    return this.textRenderQueue.schedule();
  }

  private async flushPendingTextRender(): Promise<void> {
    await this.textRenderQueue.flush();
  }

  private async executeTextRender(): Promise<void> {
    const { state } = this.deps;
    const textEl = state.currentTextEl;
    const content = state.currentTextContent;
    this.textRenderSnapshotEl = textEl;
    this.textRenderSnapshotContent = content;

    if (!textEl) {
      return;
    }

    if (!content.trim()) {
      if (textEl.isConnected) {
        textEl.remove();
      }
      state.currentTextEl = null;
      state.currentTextContent = '';
      return;
    }

    const rendered = await this.renderStreamingMarkdown(textEl, content);
    if (!rendered) {
      return;
    }

    trimEmptyEdgeParagraphs(textEl);
    if (!textEl.childElementCount && textEl.isConnected) {
      textEl.remove();
      state.currentTextEl = null;
      state.currentTextContent = '';
    }
  }

  private hasPendingTextUpdates(): boolean {
    const { state } = this.deps;
    return (
      state.currentTextEl === this.textRenderSnapshotEl
      && state.currentTextContent !== this.textRenderSnapshotContent
    );
  }

  private cancelPendingTextRender(): void {
    this.textRenderQueue.cancel();
  }

  private scheduleToolOutputRender(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingToolOutputFrames.has(toolId)) return;

    const frame = scheduleAnimationFrame(() => {
      this.pendingToolOutputFrames.delete(toolId);
      updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
      this.scrollToBottom();
    }, this.getMessagesWindow());
    this.pendingToolOutputFrames.set(toolId, frame);
  }

  private cancelPendingToolOutputRender(toolId: string): void {
    const frame = this.pendingToolOutputFrames.get(toolId);
    if (!frame) return;

    cancelScheduledAnimationFrame(frame);
    this.pendingToolOutputFrames.delete(toolId);
  }

  private cancelPendingToolOutputRenders(): void {
    for (const frame of this.pendingToolOutputFrames.values()) {
      cancelScheduledAnimationFrame(frame);
    }
    this.pendingToolOutputFrames.clear();
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return Promise.resolve();
    if (!state.currentThinkingState && !content.trim()) {
      return Promise.resolve();
    }

    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.scheduleCurrentThinkingRender();
    return Promise.resolve();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.flushPendingThinkingRender();

    const thinkingState = state.currentThinkingState;
    if (this.getStreamingRenderOptions(thinkingState.content)) {
      await renderer.renderContent(thinkingState.contentEl, thinkingState.content);
    }

    if (!thinkingState.content.trim()) {
      cleanupThinkingBlock(thinkingState);
      thinkingState.wrapperEl.remove();
      state.currentThinkingState = null;
      return;
    }

    const durationSeconds = finalizeThinkingBlock(thinkingState);

    if (msg) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: thinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  private scheduleCurrentThinkingRender(): Promise<void> {
    return this.thinkingRenderQueue.schedule();
  }

  private async flushPendingThinkingRender(): Promise<void> {
    await this.thinkingRenderQueue.flush();
  }

  private async executeThinkingRender(): Promise<void> {
    const { state } = this.deps;
    const thinkingState = state.currentThinkingState;
    const content = thinkingState?.content ?? '';
    if (thinkingState) {
      this.thinkingRenderSnapshot = { el: thinkingState.contentEl, content };
    } else {
      this.thinkingRenderSnapshot = null;
    }

    if (thinkingState) {
      await this.renderStreamingMarkdown(thinkingState.contentEl, content);
    }
  }

  private async renderStreamingMarkdown(el: HTMLElement, content: string): Promise<boolean> {
    const { renderer } = this.deps;
    try {
      const options = this.getStreamingRenderOptions(content);
      if (options) {
        await renderer.renderContent(el, content, options);
      } else {
        await renderer.renderContent(el, content);
      }
      this.scrollToBottom();
      return true;
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
      return false;
    }
  }

  private hasPendingThinkingUpdates(): boolean {
    const { state } = this.deps;
    const thinkingState = state.currentThinkingState;
    const snapshot = this.thinkingRenderSnapshot;
    return (
      thinkingState !== null
      && snapshot !== null
      && thinkingState.contentEl === snapshot.el
      && thinkingState.content !== snapshot.content
    );
  }

  private cancelPendingThinkingRender(): void {
    this.thinkingRenderQueue.cancel();
  }

  // ============================================
  // Subagent Tool Handling (via SubagentManager)
  // ============================================

  /** Delegates Agent tool_use to SubagentManager and updates message based on result. */
  private handleTaskToolUseViaManager(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state, subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input);

    const result = subagentManager.handleTaskToolUse(chunk.id, chunk.input, state.currentContentEl);

    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.showThinkingIndicator();
        break;
      case 'buffered':
        this.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  /** Renders a pending Agent tool call via SubagentManager and updates message. */
  private renderPendingTaskViaManager(toolId: string, msg: ChatMessage): void {
    const result = this.deps.subagentManager.renderPendingTask(toolId, this.deps.state.currentContentEl);
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, toolId);
    } else {
      this.recordSubagentInMessage(msg, result.info, toolId, 'async');
    }
  }

  /** Resolves a pending Agent tool call when its own tool_result arrives. */
  private renderPendingTaskFromTaskResultViaManager(
    chunk: { id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.deps.state.currentContentEl,
      chunk.toolUseResult
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async'
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, info);

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

  private handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    // If parent Agent call is still pending, child chunk confirms it's sync - render now
    if (subagentManager.hasPendingTask(parentToolUseId)) {
      this.renderPendingTaskViaManager(parentToolUseId, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);

    if (!subagentState) {
      return Promise.resolve();
    }

    switch (chunk.type) {
      case 'subagent_tool_use': {
        const toolCall: ToolCallInfo = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: 'running',
          isExpanded: false,
        };
        subagentManager.addSyncToolCall(parentToolUseId, toolCall);
        this.showThinkingIndicator();
        break;
      }

      case 'subagent_tool_result': {
        const toolCall = subagentState.info.toolCalls.find((tc: ToolCallInfo) => tc.id === chunk.id);
        if (toolCall) {
          const normalizedContent = this.normalizeToolResultContent(chunk.content);
          const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
          toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          toolCall.result = normalizedContent;
          subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
        }
        break;
      }

      default:
        break;
    }
    return Promise.resolve();
  }

  /** Finalizes a sync subagent when its Agent tool_result is received. */
  private finalizeSubagent(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
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

    this.showThinkingIndicator();
  }

  // ============================================
  // Async Subagent Handling
  // ============================================

  /** Handles TaskOutput tool_use (invisible, links to async subagent). */
  private handleAgentOutputToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    _msg: ChatMessage
  ): void {
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };

    this.deps.subagentManager.handleAgentOutputToolUse(toolCall);

    // Show flavor text while waiting for TaskOutput result
    this.showThinkingIndicator();
  }

  private handleAsyncTaskToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): boolean {
    const { subagentManager } = this.deps;
    if (!subagentManager.isPendingAsyncTask(chunk.id)) {
      return false;
    }

    subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
    return true;
  }

  /** Handles TaskOutput result to finalize async subagent. */
  private async handleAgentOutputToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
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

  private async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result
    );

    await this.hydrateAsyncSubagentToolCalls(handled);
    if (handled) {
      this.showThinkingIndicator();
    }
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
    runtime: ChatRuntime,
    hydrateToolCalls: boolean
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
    runtime: ChatRuntime,
    attempt: number
  ): void {
    if (!subagent.agentId) return;
    if (attempt >= StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS.length) return;

    const delay = StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS[attempt];
    window.setTimeout(() => {
      void this.retryAsyncSubagentResult(subagent, runtime, attempt);
    }, delay);
  }

  private async retryAsyncSubagentResult(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number
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

  /** Callback from SubagentManager when async state changes. Updates messages only (DOM handled by manager). */
  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.updateSubagentInMessages(subagent);
    this.scrollToBottom();
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

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>
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
      name: TOOL_TASK,
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

  // ============================================
  // Thinking Indicator
  // ============================================

  /** Debounce delay before showing thinking indicator (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  /**
   * Schedules showing the thinking indicator after a delay.
   * If content arrives before the delay, the indicator won't show.
   * This prevents the indicator from appearing during active streaming.
   * Note: Flavor text is hidden when model thinking block is active (thinking takes priority).
   */
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    // Early return if no content element
    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `pivi-thinking ${overrideCls}`
        : 'pivi-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      // Create timer span with initial value
      const timerSpan = state.thinkingEl.createSpan({ cls: 'pivi-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        // Check if element is still connected to DOM (prevents orphaned interval updates)
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            state.clearFlavorTimerInterval();
          }
          return;
        }
        const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer(); // Initial update

      // Start interval to update timer every second
      if (state.flavorTimerInterval) {
        state.clearFlavorTimerInterval();
      }
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);

    }, StreamController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'pivi-compact-boundary' });
    el.createSpan({ cls: 'pivi-compact-boundary-label', text: 'Session compacted' });
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Nudges Obsidian's vault after a Write/Edit/NotebookEdit so the file tree
   * refreshes. Direct `fs` writes bypass the Vault API, and macOS + iCloud
   * FSWatcher often misses the event.
   */
  private notifyObsidianVaultPathChange(input: Record<string, unknown>): void {
    const rawPath = typeof input.path === 'string' && input.path.trim()
      ? input.path.trim()
      : typeof input.file === 'string' && input.file.trim()
        ? input.file.trim()
        : undefined;
    if (!rawPath) {
      return;
    }
    this.notifyVaultFileChange({ file_path: rawPath });
  }

  private notifyVaultFileChange(input: Record<string, unknown>): void {
    const rawPathValue = input.file_path ?? input.notebook_path;
    const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
    const vaultPath = getVaultPath(this.deps.plugin.app);
    const relativePath = normalizePathForVault(rawPath, vaultPath);
    if (!relativePath || relativePath.startsWith('/')) return;

    window.setTimeout(() => {
      const { vault } = this.deps.plugin.app;
      const file = vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        // Existing file — tell listeners the content changed
        vault.trigger('modify', file);
      } else {
        // New file — scan parent directory so Obsidian discovers it
        const parentDir = relativePath.includes('/')
          ? relativePath.substring(0, relativePath.lastIndexOf('/'))
          : '';
        vault.adapter.list(parentDir).catch(() => { /* ignore */ });
      }
    }, 200);
  }

  /** Refreshes vault for each file path in an apply_patch changes array or patch text. */
  private notifyApplyPatchFileChanges(input: Record<string, unknown>): void {
    const notified = new Set<string>();

    // Legacy changes array
    const changes = input.changes;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (change && typeof change === 'object' && !Array.isArray(change)) {
          const changeRecord = change as Record<string, unknown>;
          if (typeof changeRecord.path === 'string') {
            notified.add(changeRecord.path);
            this.notifyVaultFileChange({ file_path: changeRecord.path });
          }
        }
      }
    }

    // Parse file paths from patch text markers (current custom_tool_call format)
    const patchText = typeof input.patch === 'string' ? input.patch : '';
    if (patchText) {
      for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
        const filePath = match[1]?.trim();
        if (filePath && !notified.has(filePath)) {
          this.notifyVaultFileChange({ file_path: filePath });
        }
      }
    }
  }

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    if (this.pendingScrollFrame !== null) return;

    this.pendingScrollFrame = scheduleAnimationFrame(() => {
      this.pendingScrollFrame = null;
      this.applyScrollToBottom();
    }, this.getMessagesWindow());
  }

  private applyScrollToBottom(): void {
    const { state, plugin } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    const messagesEl = this.deps.getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private cancelPendingScroll(): void {
    if (this.pendingScrollFrame === null) return;

    cancelScheduledAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  private getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.cancelPendingTextRender();
    this.cancelPendingThinkingRender();
    this.cancelPendingToolOutputRenders();
    this.cancelPendingScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
  }
}
