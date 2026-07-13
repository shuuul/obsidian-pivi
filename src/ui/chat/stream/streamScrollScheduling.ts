
import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';

import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../shared/utils/animationFrame';
import type { ChatState } from '../state/ChatState';

export interface StreamScrollSchedulerDeps {
  settings: ChatSettingsPort;
  state: ChatState;
  getMessagesEl: () => HTMLElement;
}

export class StreamScrollScheduler {
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;

  constructor(private readonly deps: StreamScrollSchedulerDeps) {}

  getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }


  scrollToBottom(): void {
    if (this.pendingScrollFrame !== null) return;

    this.pendingScrollFrame = scheduleAnimationFrame(() => {
      this.pendingScrollFrame = null;
      this.applyScrollToBottom();
    }, this.getMessagesWindow());
  }

  private applyScrollToBottom(): void {
    const { state, settings } = this.deps;
    if (!settings.getSettingsSnapshot().enableAutoScroll) return;
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

}
