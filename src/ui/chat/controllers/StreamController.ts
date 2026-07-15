import type { ChatMessage, StreamChunk, SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { ToolUseResult } from '@pivi/pivi-agent-core/foundation/diff';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';
import {
  type ChatProjectionMessageChange,
  getChatProjectionBlockId,
} from '@pivi/pivi-react/store';

import type { PiviChatHost } from '@/app/hostContracts';
import { StreamSubagentCoordinator } from '@/ui/chat/stream/streamSubagentLifecycle';
import {
  hideThinkingIndicator as hideStreamThinkingIndicator,
  showThinkingIndicator as showStreamThinkingIndicator,
} from '@/ui/chat/stream/streamThinkingIndicator';
import {
  notifyApplyPatchFileChanges,
  notifyObsidianVaultPathChange,
  notifyVaultFileChange,
} from '@/ui/chat/stream/streamVaultNotifications';
import {
  handleRegularToolResult,
  routeToolUseStreamChunk,
  shouldProjectToolUseChunk,
} from '@/ui/chat/stream/ToolEventPresenter';
import { UsagePresenter } from '@/ui/chat/stream/UsagePresenter';

import type { MessageRenderer } from '../rendering/MessageRenderer';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';

const logger = new PluginLogger('StreamController');

function projectionChangeForChunk(
  message: ChatMessage,
  chunk: StreamChunk,
): ChatProjectionMessageChange {
  switch (chunk.type) {
    case 'text':
    case 'thinking': {
      const index = (message.contentBlocks?.length ?? 0) - 1;
      if (index < 0) return { type: 'message.upsert' };
      return {
        type: 'text.append',
        blockId: getChatProjectionBlockId(message.id, index),
        delta: chunk.content,
      };
    }
    case 'tool_use':
    case 'tool_result':
    case 'tool_output': {
      const tool = message.toolCalls?.find(candidate => candidate.id === chunk.id);
      return tool ? { type: 'tool.upsert', tool } : { type: 'message.upsert' };
    }
    case 'subagent_text':
    case 'subagent_tool_use':
    case 'subagent_tool_result': {
      const agent = message.toolCalls?.find(candidate => (
        candidate.subagent?.id === chunk.subagentId
        || candidate.subagent?.agentId === chunk.subagentId
      ))?.subagent;
      return agent ? { type: 'agent.upsert', agent } : { type: 'message.upsert' };
    }
    case 'async_subagent_result': {
      const targetId = chunk.subagentId ?? chunk.agentId;
      const agent = message.toolCalls?.find(candidate => (
        candidate.subagent?.id === targetId || candidate.subagent?.agentId === targetId
      ))?.subagent;
      return agent ? { type: 'agent.upsert', agent } : { type: 'message.upsert' };
    }
    default:
      return { type: 'message.upsert' };
  }
}

function childRunIdForChunk(chunk: StreamChunk): string | null {
  switch (chunk.type) {
    case 'subagent_text':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return chunk.subagentId;
    case 'async_subagent_result':
      return chunk.subagentId ?? chunk.agentId;
    default:
      return null;
  }
}

export interface StreamControllerDeps {
  plugin: PiviChatHost;
  settings: ChatSettingsPort;
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
  private backgroundChunkTail: Promise<void> = Promise.resolve();
  private readonly usagePresenter: UsagePresenter;
  private readonly subagentCoordinator: StreamSubagentCoordinator;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
    this.subagentCoordinator = new StreamSubagentCoordinator({
      state: deps.state,
      subagentManager: deps.subagentManager,
      getAgentService: deps.getAgentService,
      showThinkingIndicator: () => this.showThinkingIndicator(),
      scrollToBottom: () => {},
    });
    this.usagePresenter = new UsagePresenter({
      settings: deps.settings,
      state: deps.state,
      subagentManager: deps.subagentManager,
      getAgentService: deps.getAgentService,
    });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleBackgroundSubagentChunk(chunk: StreamChunk): Promise<void> {
    const work = this.backgroundChunkTail.then(async () => {
      const targetMessage = this.findBackgroundSubagentMessage(chunk);
      if (!targetMessage) {
        const subagentId = 'subagentId' in chunk ? chunk.subagentId : undefined;
        const agentId = chunk.type === 'async_subagent_result' ? chunk.agentId : undefined;
        logger.warn(
          `Dropped background Agent chunk without an owner: type=${chunk.type} subagent=${subagentId ?? 'none'} agent=${agentId ?? 'none'}`,
        );
        return;
      }
      await this.handleStreamChunk(chunk, targetMessage, { backgroundSubagent: true });
    });
    this.backgroundChunkTail = work.catch((error: unknown) => {
      logger.warn('Failed to project a background Agent chunk', error);
    });
    return work;
  }

  async handleStreamChunk(
    chunk: StreamChunk,
    msg: ChatMessage,
    options: { backgroundSubagent?: boolean } = {},
  ): Promise<void> {
    if (
      chunk.type !== 'tool_use'
      || shouldProjectToolUseChunk(chunk.name, resolveSubagentLifecycleAdapter(chunk.name))
    ) {
      msg = this.deps.state.projectStreamChunk(msg, chunk);
    }
    switch (chunk.type) {
      case 'thinking':
        this.handleThinkingChunk();
        break;

      case 'text':
        this.handleTextChunk();
        break;

      case 'tool_use':
        this.handleToolUseChunk(chunk, msg);
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
        this.handleToolOutput();
        break;

      case 'notice':
        this.handleNoticeChunk();
        break;

      case 'error':
        this.handleErrorChunk();
        break;

      case 'done':
        break;

      case 'context_compacting':
        this.handleContextCompactingChunk();
        break;

      case 'context_compacted':
        this.handleContextCompactedChunk();
        break;

      case 'usage':
        this.handleUsageChunk(chunk);
        break;

      default:
        break;
    }

    this.deps.state.notifyMessageChanged(
      msg,
      projectionChangeForChunk(msg, chunk),
      { childRunId: childRunIdForChunk(chunk) },
    );
    if (chunk.type === 'async_subagent_result') {
      this.deps.state.completeProjectionRun({
        childRunId: chunk.subagentId ?? chunk.agentId,
      });
    }
  }

  private findBackgroundSubagentMessage(chunk: StreamChunk): ChatMessage | null {
    const subagentId = 'subagentId' in chunk && typeof chunk.subagentId === 'string'
      ? chunk.subagentId
      : null;
    const agentId = chunk.type === 'async_subagent_result' ? chunk.agentId : null;
    return this.deps.state.findOwnerMessage({ subagentId, agentId });
  }

  private handleThinkingChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleTextChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleToolUseChunk(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
    msg: ChatMessage,
  ): void {
    this.hideThinkingIndicator();

    const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(chunk.name);
    switch (routeToolUseStreamChunk(chunk.name, subagentLifecycleAdapter)) {
      case 'subagent_task':
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
        this.handleRegularToolUse();
        break;
    }
  }

  private handleNoticeChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleErrorChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleContextCompactedChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleContextCompactingChunk(): void {
    this.hideThinkingIndicator();
  }

  private handleUsageChunk(chunk: Extract<StreamChunk, { type: 'usage' }>): void {
    this.usagePresenter.handleUsageChunk(chunk);
  }

  private handleRegularToolUse(): void {
    this.showThinkingIndicator();
  }

  private handleToolOutput(): void {
    this.showThinkingIndicator();
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
      notifyVaultFileChange: (input) => notifyVaultFileChange(plugin, input),
      notifyObsidianVaultPathChange: (input) => notifyObsidianVaultPathChange(plugin, input),
      notifyApplyPatchFileChanges: (input) => notifyApplyPatchFileChanges(plugin, input),
      showThinkingIndicator: () => this.showThinkingIndicator(),
    }, chunk, msg, normalizedContent);
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
    this.hideThinkingIndicator();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    state.flushProjection();
    this.hideThinkingIndicator();
    state.currentTextContent = '';
    this.subagentCoordinator.resetStreamingState();
    this.deps.subagentManager.resetStreamingState();
    state.responseStartTime = null;
  }

  dispose(): void {
    this.deps.state.flushProjection();
    this.subagentCoordinator.dispose();
  }
}
