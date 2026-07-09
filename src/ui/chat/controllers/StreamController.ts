import type { ChatMessage, StreamChunk, SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { ToolUseResult } from '@pivi/pivi-agent-core/foundation/diff';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';
import { PendingToolRendering } from '@/ui/chat/stream/PendingToolPresenter';
import { StreamScrollScheduler } from '@/ui/chat/stream/streamScrollScheduling';
import { StreamSubagentCoordinator } from '@/ui/chat/stream/streamSubagentLifecycle';
import {
  hideThinkingIndicator as hideStreamThinkingIndicator,
  showThinkingIndicator as showStreamThinkingIndicator,
} from '@/ui/chat/stream/streamThinkingIndicator';
import { closeStreamingToolStepGroup } from '@/ui/chat/stream/streamToolStepGroupBoundary';
import {
  notifyApplyPatchFileChanges,
  notifyObsidianVaultPathChange,
  notifyVaultFileChange,
} from '@/ui/chat/stream/streamVaultNotifications';
import { TextStreamPresenter } from '@/ui/chat/stream/TextStreamPresenter';
import { ThinkingStreamPresenter } from '@/ui/chat/stream/ThinkingStreamPresenter';
import { handleRegularToolResult, routeToolUseStreamChunk } from '@/ui/chat/stream/ToolEventPresenter';
import { UsagePresenter } from '@/ui/chat/stream/UsagePresenter';

import { hasStreamingMathDelimiters } from '../../shared/utils/markdownMath';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import { updateAssistantToolOnlyClass } from '../rendering/messageRendererAssistant';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';

export interface StreamControllerDeps {
  plugin: PiviPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => PiChatService | null;
}

export class StreamController {
  private deps: StreamControllerDeps;
  private readonly textPresenter: TextStreamPresenter;
  private readonly thinkingPresenter: ThinkingStreamPresenter;
  private readonly usagePresenter: UsagePresenter;
  private readonly pendingToolRendering: PendingToolRendering;
  private readonly scrollScheduler: StreamScrollScheduler;
  private readonly subagentCoordinator: StreamSubagentCoordinator;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
    this.scrollScheduler = new StreamScrollScheduler({
      plugin: deps.plugin,
      state: deps.state,
      getMessagesEl: deps.getMessagesEl,
    });
    this.subagentCoordinator = new StreamSubagentCoordinator({
      state: deps.state,
      subagentManager: deps.subagentManager,
      getAgentService: deps.getAgentService,
      flushPendingTools: () => this.flushPendingTools(),
      showThinkingIndicator: () => this.showThinkingIndicator(),
      scrollToBottom: () => this.scrollToBottom(),
    });
    this.textPresenter = new TextStreamPresenter({
      state: deps.state,
      renderer: deps.renderer,
      getRenderWindow: () => this.scrollScheduler.getStreamingRenderWindow() ?? undefined,
      getStreamingRenderOptions: (content) => this.getStreamingRenderOptions(content),
      shouldRenderDeferredMath: (content) => this.shouldRenderDeferredMath(content),
      hideThinkingIndicator: () => this.hideThinkingIndicator(),
      scrollToBottom: () => this.scrollToBottom(),
    });
    this.thinkingPresenter = new ThinkingStreamPresenter({
      state: deps.state,
      renderer: deps.renderer,
      getRenderWindow: () => this.scrollScheduler.getThinkingRenderWindow() ?? undefined,
      getStreamingRenderOptions: (content) => this.getStreamingRenderOptions(content),
      hideThinkingIndicator: () => this.hideThinkingIndicator(),
      scrollToBottom: () => this.scrollToBottom(),
    });
    this.usagePresenter = new UsagePresenter({
      plugin: deps.plugin,
      state: deps.state,
      subagentManager: deps.subagentManager,
      getAgentService: deps.getAgentService,
    });
    this.pendingToolRendering = new PendingToolRendering({
      state: deps.state,
      showThinkingIndicator: () => this.showThinkingIndicator(),
      scheduleToolOutputRender: (toolId, toolCall) => this.scrollScheduler.scheduleToolOutputRender(toolId, toolCall),
    });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleBackgroundSubagentChunk(chunk: StreamChunk): Promise<void> {
    const targetMessage = this.findBackgroundSubagentMessage(chunk);
    if (!targetMessage) {
      return;
    }
    await this.handleStreamChunk(chunk, targetMessage, { backgroundSubagent: true });
  }

  async handleStreamChunk(
    chunk: StreamChunk,
    msg: ChatMessage,
    options: { backgroundSubagent?: boolean } = {},
  ): Promise<void> {
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
        await this.subagentCoordinator.handleSubagentChunk(chunk, msg, {
          showThinkingIndicator: !options.backgroundSubagent,
        });
        break;

      case 'subagent_text':
        this.subagentCoordinator.handleSubagentText(chunk, msg, {
          showThinkingIndicator: !options.backgroundSubagent,
        });
        break;

      case 'async_subagent_result':
        await this.subagentCoordinator.handleAsyncSubagentResult(chunk, {
          showThinkingIndicator: !options.backgroundSubagent,
        });
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
        this.flushPendingTools();
        break;

      case 'context_compacting':
        await this.handleContextCompactingChunk(msg);
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

  private findBackgroundSubagentMessage(chunk: StreamChunk): ChatMessage | null {
    const subagentId = 'subagentId' in chunk && typeof chunk.subagentId === 'string'
      ? chunk.subagentId
      : null;
    const assistantMessages = this.deps.state.messages.filter((message) => message.role === 'assistant');
    if (subagentId) {
      const owner = assistantMessages.find((message) => (
        message.contentBlocks?.some((block) => block.type === 'subagent' && block.subagentId === subagentId)
        || message.toolCalls?.some((toolCall) => (
          toolCall.id === subagentId || toolCall.subagent?.id === subagentId
        ))
      ));
      if (owner) {
        return owner;
      }
    }
    const agentId = chunk.type === 'async_subagent_result' ? chunk.agentId : null;
    if (agentId) {
      const owner = assistantMessages.find((message) => (
        message.toolCalls?.some((toolCall) => toolCall.subagent?.agentId === agentId)
      ));
      if (owner) {
        return owner;
      }
    }
    return null;
  }

  private async handleThinkingChunk(
    chunk: Extract<StreamChunk, { type: 'thinking' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const { state } = this.deps;
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

    const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(chunk.name);
    switch (routeToolUseStreamChunk(chunk.name, subagentLifecycleAdapter)) {
      case 'subagent_task':
        this.flushPendingTools();
        this.subagentCoordinator.handleTaskToolUseViaManager(chunk, msg);
        break;
      case 'agent_output':
        this.subagentCoordinator.handleAgentOutputToolUse(chunk, msg);
        break;
      case 'subagent_spawn':
        if (subagentLifecycleAdapter) {
          this.subagentCoordinator.handleSubagentSpawn(chunk, msg, subagentLifecycleAdapter);
        }
        break;
      case 'subagent_hidden':
        this.subagentCoordinator.handleHiddenSubagentTool(chunk, msg);
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
    this.flushPendingTools();
    await this.appendText(`\n\n❌ **Error:** ${chunk.content}`);
  }

  private async handleContextCompactedChunk(msg: ChatMessage): Promise<void> {
    const { state } = this.deps;
    this.flushPendingTools();
    closeStreamingToolStepGroup(state);
    this.hideThinkingIndicator();
    const lastBlock = msg.contentBlocks?.[msg.contentBlocks.length - 1];
    if (lastBlock?.type === 'context_compacted') {
      return;
    }
    if (state.currentThinkingState) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    await this.finalizeCurrentTextBlock(msg);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'context_compacted' });
    this.renderCompactBoundary();
  }

  private async handleContextCompactingChunk(msg: ChatMessage): Promise<void> {
    const { state } = this.deps;
    this.flushPendingTools();
    closeStreamingToolStepGroup(state);
    if (state.currentThinkingState) {
      await this.finalizeCurrentThinkingBlock(msg);
    }
    await this.finalizeCurrentTextBlock(msg);
    this.showThinkingIndicator('Compacting...', 'pivi-thinking--compact');
  }

  private handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    this.usagePresenter.handleUsageChunk(chunk);
  }

  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
  ): void {
    this.pendingToolRendering.handleRegularToolUse(chunk, msg);
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private shouldRenderDeferredMath(content: string): boolean {
    return this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content);
  }

  private getStreamingRenderOptions(content: string): RenderContentOptions | undefined {
    return this.shouldRenderDeferredMath(content)
      ? { deferMath: true }
      : undefined;
  }

  private flushPendingTools(): void {
    this.pendingToolRendering.flushPendingTools();
  }

  private renderPendingTool(toolId: string): void {
    this.pendingToolRendering.renderPendingTool(toolId);
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    this.pendingToolRendering.handleToolOutput(chunk, msg);
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: ToolUseResult },
    msg: ChatMessage,
  ): Promise<void> {
    const { state, subagentManager } = this.deps;
    const normalizedContent = extractToolResultContent(chunk.content, { fallbackIndent: 2 });

    if (subagentManager.hasPendingTask(chunk.id)) {
      this.subagentCoordinator.renderPendingTaskFromTaskResultViaManager(chunk, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(chunk.id);
    if (subagentState) {
      this.subagentCoordinator.finalizeSubagent(chunk, msg);
      return;
    }

    if (this.subagentCoordinator.handleAsyncTaskToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (await this.subagentCoordinator.handleAgentOutputToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (this.subagentCoordinator.handleSubagentResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    const { plugin } = this.deps;
    handleRegularToolResult({
      state,
      renderPendingTool: (toolId) => this.renderPendingTool(toolId),
      cancelPendingToolOutputRender: (toolId) => this.scrollScheduler.cancelPendingToolOutputRender(toolId),
      notifyVaultFileChange: (input) => notifyVaultFileChange(plugin, input),
      notifyObsidianVaultPathChange: (input) => notifyObsidianVaultPathChange(plugin, input),
      notifyApplyPatchFileChanges: (input) => notifyApplyPatchFileChanges(plugin, input),
      showThinkingIndicator: () => this.showThinkingIndicator(),
    }, chunk, msg, normalizedContent);
  }

  // ============================================
  // Text / thinking blocks
  // ============================================

  appendText(text: string): Promise<void> {
    return this.textPresenter.appendText(text);
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    await this.textPresenter.finalizeCurrentTextBlock(msg);
  }

  private cancelPendingTextRender(): void {
    this.textPresenter.cancel();
  }

  appendThinking(content: string): Promise<void> {
    return this.thinkingPresenter.appendThinking(content);
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    await this.thinkingPresenter.finalizeCurrentThinkingBlock(msg);
  }

  private cancelPendingThinkingRender(): void {
    this.thinkingPresenter.cancel();
  }

  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.subagentCoordinator.onAsyncSubagentStateChange(subagent);
  }

  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    showStreamThinkingIndicator({
      state: this.deps.state,
      updateQueueIndicator: this.deps.updateQueueIndicator,
      getMessagesEl: this.deps.getMessagesEl,
    }, overrideText, overrideCls);
  }

  hideThinkingIndicator(): void {
    hideStreamThinkingIndicator({
      state: this.deps.state,
      updateQueueIndicator: this.deps.updateQueueIndicator,
      getMessagesEl: this.deps.getMessagesEl,
    });
  }

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'pivi-compact-boundary' });
    el.createSpan({ cls: 'pivi-compact-boundary-label', text: t('chat.stream.sessionCompacted') });
    updateAssistantToolOnlyClass(state.currentContentEl);
  }

  private scrollToBottom(): void {
    this.scrollScheduler.scrollToBottom();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.cancelPendingTextRender();
    this.cancelPendingThinkingRender();
    this.scrollScheduler.cancelPendingToolOutputRenders();
    this.scrollScheduler.cancelPendingScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    this.subagentCoordinator.resetStreamingState();
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    closeStreamingToolStepGroup(state);
    state.responseStartTime = null;
  }
}
