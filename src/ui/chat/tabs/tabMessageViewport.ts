import type { ChatState } from '../state/ChatState';

const NAVIGATION_OVERFLOW_THRESHOLD = 50;

interface MessageViewportOptions {
  messagesEl: HTMLElement;
  messagesPortalEl: HTMLElement;
  state: Pick<ChatState, 'navigationVisible'>;
}

/** Keep navigation and auto-scroll aligned with asynchronous message layout. */
export function wireMessageViewport({
  messagesEl,
  messagesPortalEl,
  state,
}: MessageViewportOptions): () => void {
  const syncNavigationVisibility = () => {
    state.navigationVisible =
      messagesEl.scrollHeight > messagesEl.clientHeight + NAVIGATION_OVERFLOW_THRESHOLD;
  };

  messagesEl.addEventListener('scroll', syncNavigationVisibility, { passive: true });

  const ResizeObserverCtor = messagesEl.ownerDocument.defaultView?.ResizeObserver;
  const resizeObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(syncNavigationVisibility)
    : null;
  resizeObserver?.observe(messagesEl);
  resizeObserver?.observe(messagesPortalEl);
  syncNavigationVisibility();

  return () => {
    messagesEl.removeEventListener('scroll', syncNavigationVisibility);
    resizeObserver?.disconnect();
  };
}
