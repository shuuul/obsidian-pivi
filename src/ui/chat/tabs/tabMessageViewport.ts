import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';

import type { ChatState } from '../state/ChatState';
import { isUserInteractingWithSubagent } from '../stream/streamScrollScheduling';

const NAVIGATION_OVERFLOW_THRESHOLD = 50;

interface MessageViewportOptions {
  messagesEl: HTMLElement;
  messagesPortalEl: HTMLElement;
  settings: ChatSettingsPort;
  state: Pick<ChatState, 'autoScrollEnabled' | 'navigationVisible'>;
}

/** Keep navigation and auto-scroll aligned with asynchronous message layout. */
export function wireMessageViewport({
  messagesEl,
  messagesPortalEl,
  settings,
  state,
}: MessageViewportOptions): () => void {
  const syncNavigationVisibility = () => {
    state.navigationVisible =
      messagesEl.scrollHeight > messagesEl.clientHeight + NAVIGATION_OVERFLOW_THRESHOLD;
  };
  const handleContentResize = () => {
    if (
      settings.getSettingsSnapshot().enableAutoScroll
      && state.autoScrollEnabled
      && !isUserInteractingWithSubagent(messagesEl)
    ) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    syncNavigationVisibility();
  };

  messagesEl.addEventListener('scroll', syncNavigationVisibility, { passive: true });

  const ResizeObserverCtor = messagesEl.ownerDocument.defaultView?.ResizeObserver;
  const resizeObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(handleContentResize)
    : null;
  resizeObserver?.observe(messagesEl);
  resizeObserver?.observe(messagesPortalEl);
  syncNavigationVisibility();

  return () => {
    messagesEl.removeEventListener('scroll', syncNavigationVisibility);
    resizeObserver?.disconnect();
  };
}
