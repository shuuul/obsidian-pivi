import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

import { hasStreamingMathDelimiters } from '../../shared/utils/markdownMath';
import {
  stripLeadingWhitespaceForNewTextBlock,
  trimEmptyEdgeParagraphs,
} from '../rendering/markdownContentCleanup';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import { updateAssistantToolOnlyClass } from '../rendering/messageRendererAssistant';
import type { ChatState } from '../state/ChatState';
import { clearStreamingToolStepGroup } from './PendingToolPresenter';
import { StreamRenderQueue } from './StreamRenderQueue';

export interface TextStreamPresenterDeps {
  state: ChatState;
  renderer: MessageRenderer;
  getRenderWindow: () => Window | undefined;
  getStreamingRenderOptions: (content: string) => RenderContentOptions | undefined;
  shouldRenderDeferredMath: (content: string) => boolean;
  hideThinkingIndicator: () => void;
  scrollToBottom: () => void;
}

export class TextStreamPresenter {
  private renderSnapshotEl: HTMLElement | null = null;
  private renderSnapshotContent = '';
  private readonly renderQueue: StreamRenderQueue;

  constructor(private readonly deps: TextStreamPresenterDeps) {
    this.renderQueue = new StreamRenderQueue(
      deps.getRenderWindow,
      () => this.executeRender(),
      () => this.hasPendingUpdates(),
    );
  }

  appendText(text: string): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return Promise.resolve();

    this.deps.hideThinkingIndicator();

    if (!state.currentTextEl) {
      const stripped = stripLeadingWhitespaceForNewTextBlock(text);
      if (!stripped) {
        return Promise.resolve();
      }
      text = stripped;
      clearStreamingToolStepGroup(state);
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'pivi-text-block' });
      state.currentTextContent = '';
      updateAssistantToolOnlyClass(state.currentContentEl);
    }

    state.currentTextContent += text;
    void this.renderQueue.schedule();
    return Promise.resolve();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.renderQueue.flush();

    const textContent = state.currentTextContent ?? '';
    const hasVisibleText = textContent.trim().length > 0;

    if (msg && hasVisibleText) {
      if (state.currentTextEl && this.deps.shouldRenderDeferredMath(textContent)) {
        await renderer.renderContent(state.currentTextEl, textContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: textContent });
    } else if (state.currentTextEl?.isConnected) {
      state.currentTextEl.remove();
    }

    if (state.currentContentEl) {
      updateAssistantToolOnlyClass(state.currentContentEl);
    }

    state.currentTextEl = null;
    state.currentTextContent = '';
  }

  cancel(): void {
    this.renderQueue.cancel();
  }

  private async executeRender(): Promise<void> {
    const { state } = this.deps;
    const textEl = state.currentTextEl;
    const content = state.currentTextContent;
    this.renderSnapshotEl = textEl;
    this.renderSnapshotContent = content;

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

  private hasPendingUpdates(): boolean {
    const { state } = this.deps;
    return (
      state.currentTextEl === this.renderSnapshotEl
      && state.currentTextContent !== this.renderSnapshotContent
    );
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
}

export function shouldRenderDeferredMath(
  deferMathRenderingDuringStreaming: boolean,
  content: string,
): boolean {
  return deferMathRenderingDuringStreaming && hasStreamingMathDelimiters(content);
}
