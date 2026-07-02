import type { ChatMessage } from '@pivi/core';

import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import type { SubagentState } from '../rendering/SubagentRenderer';
import {
  cleanupThinkingBlock,
  createThinkingBlock,
  finalizeThinkingBlock,
} from '../rendering/ThinkingBlockRenderer';
import type { ChatState } from '../state/ChatState';
import { StreamRenderQueue } from './StreamRenderQueue';

export interface ThinkingStreamPresenterDeps {
  state: ChatState;
  renderer: MessageRenderer;
  getRenderWindow: () => Window | undefined;
  getStreamingRenderOptions: (content: string) => RenderContentOptions | undefined;
  hideThinkingIndicator: () => void;
  scrollToBottom: () => void;
}

export class ThinkingStreamPresenter {
  private renderSnapshot: { el: HTMLElement; content: string } | null = null;
  private readonly renderQueue: StreamRenderQueue;

  constructor(private readonly deps: ThinkingStreamPresenterDeps) {
    this.renderQueue = new StreamRenderQueue(
      deps.getRenderWindow,
      () => this.executeRender(),
      () => this.hasPendingUpdates(),
    );
  }

  appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return Promise.resolve();
    if (!state.currentThinkingState && !content.trim()) {
      return Promise.resolve();
    }

    this.deps.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.renderQueue.schedule();
    return Promise.resolve();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.renderQueue.flush();

    const thinkingState = state.currentThinkingState;
    if (this.deps.getStreamingRenderOptions(thinkingState.content)) {
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

  cancel(): void {
    this.renderQueue.cancel();
  }

  private async executeRender(): Promise<void> {
    const { state } = this.deps;
    const thinkingState = state.currentThinkingState;
    const content = thinkingState?.content ?? '';
    if (thinkingState) {
      this.renderSnapshot = { el: thinkingState.contentEl, content };
    } else {
      this.renderSnapshot = null;
    }

    if (thinkingState) {
      await this.renderStreamingMarkdown(thinkingState.contentEl, content);
    }
  }

  private async renderStreamingMarkdown(el: HTMLElement, content: string): Promise<boolean> {
    const { renderer } = this.deps;
    try {
      const options = this.deps.getStreamingRenderOptions(content);
      if (options) {
        await renderer.renderContent(el, content, options);
      } else {
        await renderer.renderContent(el, content);
      }
      this.deps.scrollToBottom();
      return true;
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
      return false;
    }
  }

  private hasPendingUpdates(): boolean {
    const { state } = this.deps;
    const thinkingState = state.currentThinkingState;
    const snapshot = this.renderSnapshot;
    return (
      thinkingState !== null
      && snapshot !== null
      && thinkingState.contentEl === snapshot.el
      && thinkingState.content !== snapshot.content
    );
  }
}

export type { SubagentState };
