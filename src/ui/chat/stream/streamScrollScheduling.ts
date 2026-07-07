import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';

import type PiviPlugin from '@/app/PiviPluginHost';

import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../shared/utils/animationFrame';
import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';

export interface StreamScrollSchedulerDeps {
  plugin: PiviPlugin;
  state: ChatState;
  getMessagesEl: () => HTMLElement;
}

export class StreamScrollScheduler {
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;

  constructor(private readonly deps: StreamScrollSchedulerDeps) {}

  getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  scrollToBottom(): void {
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
    if (this.isUserInteractingWithSubagent(messagesEl)) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private isUserInteractingWithSubagent(messagesEl: HTMLElement): boolean {
    const activeElement = messagesEl.ownerDocument.activeElement;
    if (
      activeElement
      && typeof activeElement.closest === 'function'
      && !!activeElement.closest('.pivi-subagent-list')
      && typeof messagesEl.contains === 'function'
      && messagesEl.contains(activeElement)
    ) {
      return true;
    }

    return typeof messagesEl.find === 'function'
      && !!messagesEl.find('.pivi-subagent-list:hover');
  }

  cancelPendingScroll(): void {
    if (this.pendingScrollFrame === null) return;

    cancelScheduledAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  scheduleToolOutputRender(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingToolOutputFrames.has(toolId)) return;

    const frame = scheduleAnimationFrame(() => {
      this.pendingToolOutputFrames.delete(toolId);
      updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
      this.scrollToBottom();
    }, this.getMessagesWindow());
    this.pendingToolOutputFrames.set(toolId, frame);
  }

  cancelPendingToolOutputRender(toolId: string): void {
    const frame = this.pendingToolOutputFrames.get(toolId);
    if (!frame) return;

    cancelScheduledAnimationFrame(frame);
    this.pendingToolOutputFrames.delete(toolId);
  }

  cancelPendingToolOutputRenders(): void {
    for (const frame of this.pendingToolOutputFrames.values()) {
      cancelScheduledAnimationFrame(frame);
    }
    this.pendingToolOutputFrames.clear();
  }
}
