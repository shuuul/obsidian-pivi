import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import {
  observeElementRect,
  type Rect,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import type { ChatProjectionStore, ChatUiSnapshot } from '../../store';
import { useChatProjectionMessageStructure, useChatProjectionOrder } from '../../store';
import { DisclosureAnchorProvider } from './disclosureAnchorContext';
import {
  createDisclosureViewportController,
  type DisclosureViewportController,
} from './disclosureViewport';
import { MemoryBoundary } from './MemoryBoundary';
import { MessageView } from './MessageView';
import type {
  BeginDisclosureResize,
  MessageContentAdapters,
  MessagePresentationActions,
  MessageViewportHandle,
} from './types';

const THINKING_ITEM_KEY = 'pivi:streaming-thinking';
const HISTORY_BOUNDARY_ITEM_KEY = 'pivi:older-history-boundary';
const MESSAGE_ESTIMATED_HEIGHT = 120;
const MESSAGE_OVERSCAN = 6;
const SCROLL_END_THRESHOLD = 80;

export interface MessageListProps {
  readonly store: ChatProjectionStore;
  readonly scrollElement: HTMLElement;
  readonly isStreaming: boolean;
  readonly autoScrollEnabled: boolean;
  readonly thinkingIndicator: ChatUiSnapshot['thinkingIndicator'];
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
  readonly hasOlderMessages?: boolean;
  readonly onLoadPreviousPage?: () => Promise<boolean>;
  readonly onViewportHandle?: (handle: MessageViewportHandle | null) => void;
}

function findStreamingTurnStart(
  store: ChatProjectionStore,
  messageIds: readonly string[],
): number {
  for (let index = messageIds.length - 1; index >= 0; index -= 1) {
    const message = store.getMessageSnapshot(messageIds[index] ?? '');
    if (message?.role === 'user' && !message.isRebuiltContext) return index;
  }
  return messageIds.length;
}

function StreamingThinkingRow({
  indicator,
}: {
  indicator: ChatUiSnapshot['thinkingIndicator'];
}) {
  if (!indicator) return null;
  return (
    <div className={`${indicator.className} pivi-response-meta`}>
      <span>{indicator.text}</span>
      <span className="pivi-thinking-hint">{indicator.elapsedLabel}</span>
    </div>
  );
}

function ProjectedMessageRow({
  actions,
  contentAdapters,
  hideActions,
  isStreaming,
  messageId,
  store,
}: {
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
  readonly hideActions: boolean;
  readonly isStreaming: boolean;
  readonly messageId: string;
  readonly store: ChatProjectionStore;
}) {
  const message = useChatProjectionMessageStructure(store, messageId);
  if (!message) return null;
  return (
    <MessageView
      actions={actions}
      contentAdapters={contentAdapters}
      hideActions={hideActions}
      isStreaming={isStreaming}
      message={message as ChatMessage}
      projectionStore={store}
    />
  );
}

/** Virtualized, entity-subscribed transcript. */
export function MessageList({
  actions,
  autoScrollEnabled,
  contentAdapters,
  hasOlderMessages = false,
  isStreaming,
  onLoadPreviousPage,
  onViewportHandle,
  scrollElement,
  store,
  thinkingIndicator,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<{ id: string; top: number } | null>(null);
  const pendingAnchorFrameRef = useRef<number | null>(null);
  const streamingFollowFrameRef = useRef<number | null>(null);
  const streamingFollowRef = useRef(autoScrollEnabled);
  const previousAutoScrollRef = useRef(autoScrollEnabled);
  const previousStreamingRef = useRef(isStreaming);
  const previousPageRequestRef = useRef<Promise<boolean> | null>(null);
  const disclosureViewportRef = useRef<DisclosureViewportController | null>(null);
  const messageIds = useChatProjectionOrder(store);
  const hasThinking = thinkingIndicator !== null;
  const boundaryCount = hasOlderMessages ? 1 : 0;
  const count = boundaryCount + messageIds.length + (hasThinking ? 1 : 0);
  const streamingTurnStart = useMemo(
    () => isStreaming ? findStreamingTurnStart(store, messageIds) : messageIds.length,
    [isStreaming, messageIds, store],
  );
  const getItemKey = useCallback((index: number) => {
    if (hasOlderMessages && index === 0) return HISTORY_BOUNDARY_ITEM_KEY;
    const messageIndex = index - boundaryCount;
    return messageIndex < messageIds.length
      ? messageIds[messageIndex] ?? index
      : THINKING_ITEM_KEY;
  }, [boundaryCount, hasOlderMessages, messageIds]);
  const observeViewportRect = useCallback((
    instance: Virtualizer<HTMLElement, Element>,
    callback: (rect: Rect) => void,
  ) => observeElementRect(
    instance,
    rect => callback({
      width: rect.width || Math.max(1, scrollElement.clientWidth),
      height: rect.height || Math.max(600, scrollElement.clientHeight),
    }),
  ), [scrollElement]);
  const scheduleStreamingFollow = useCallback((
    instance: Virtualizer<HTMLElement, Element>,
  ) => {
    const ownerWindow = scrollElement.ownerDocument.defaultView;
    if (!ownerWindow || streamingFollowFrameRef.current !== null) return;
    streamingFollowFrameRef.current = ownerWindow.requestAnimationFrame(() => {
      streamingFollowFrameRef.current = null;
      if (!streamingFollowRef.current) return;
      instance.scrollToEnd({ behavior: 'auto' });
    });
  }, [scrollElement]);

  const virtualizer = useVirtualizer({
    anchorTo: 'end',
    count,
    directDomUpdates: false,
    estimateSize: index => hasOlderMessages && index === 0 ? 40 : MESSAGE_ESTIMATED_HEIGHT,
    followOnAppend: autoScrollEnabled ? 'auto' : false,
    getItemKey,
    getScrollElement: () => scrollElement,
    initialRect: {
      width: Math.max(1, scrollElement.clientWidth),
      height: Math.max(600, scrollElement.clientHeight),
    },
    onChange: (instance, sync) => {
      if (
        sync
        && instance.scrollDirection === 'backward'
        && !instance.isAtEnd(SCROLL_END_THRESHOLD)
      ) {
        streamingFollowRef.current = false;
      } else if (!sync && isStreaming && streamingFollowRef.current) {
        scheduleStreamingFollow(instance);
      }
      if (
        sync
        && instance.scrollDirection === 'backward'
        && (instance.scrollOffset ?? 0) <= SCROLL_END_THRESHOLD
      ) {
        if (store.perfRecorder.enabled) {
          const anchor = instance.getVirtualItems()[0];
          const row = anchor
            ? Array.from(listRef.current?.children ?? []).find(element => (
                element.instanceOf(HTMLElement)
                && element.dataset.itemKey === String(anchor.key)
              ))
            : null;
          pendingAnchorRef.current = anchor && row
            ? { id: String(anchor.key), top: row.getBoundingClientRect().top }
            : null;
        }
        if (!onLoadPreviousPage || previousPageRequestRef.current) {
          pendingAnchorRef.current = null;
          return;
        }
        const request = onLoadPreviousPage();
        previousPageRequestRef.current = request;
        void request.then((loaded) => {
          if (!loaded) pendingAnchorRef.current = null;
        }).finally(() => {
          if (previousPageRequestRef.current === request) {
            previousPageRequestRef.current = null;
          }
        });
      }
    },
    overscan: MESSAGE_OVERSCAN,
    observeElementRect: observeViewportRect,
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const startedStreaming = isStreaming && !previousStreamingRef.current;
    const resumedAutoScroll = (
      isStreaming
      && autoScrollEnabled
      && !previousAutoScrollRef.current
    );
    previousStreamingRef.current = isStreaming;
    previousAutoScrollRef.current = autoScrollEnabled;
    streamingFollowRef.current = autoScrollEnabled;
    if (autoScrollEnabled && (startedStreaming || resumedAutoScroll)) {
      scheduleStreamingFollow(virtualizer);
    }
  }, [autoScrollEnabled, isStreaming, scheduleStreamingFollow, virtualizer]);

  useLayoutEffect(() => {
    const controller = createDisclosureViewportController(scrollElement);
    disclosureViewportRef.current = controller;
    return () => {
      if (disclosureViewportRef.current === controller) {
        disclosureViewportRef.current = null;
      }
      controller.dispose();
    };
  }, [scrollElement]);

  const beginDisclosureResize = useCallback<BeginDisclosureResize>((header) => {
    disclosureViewportRef.current?.beginDisclosureResize(header);
  }, []);

  useLayoutEffect(() => {
    store.setOwnerWindow(scrollElement.ownerDocument.defaultView);
    virtualizer.scrollToEnd({ behavior: 'instant' });
    return () => store.setOwnerWindow(null);
  }, [scrollElement, store, virtualizer]);

  useLayoutEffect(() => {
    const findMessageIndex = (messageId: string): number => messageIds.indexOf(messageId);
    const findUserIndex = (start: number, direction: 'prev' | 'next'): number => {
      const step = direction === 'prev' ? -1 : 1;
      for (let index = start; index >= 0 && index < messageIds.length; index += step) {
        const candidate = store.getMessageSnapshot(messageIds[index] ?? '');
        if (candidate?.role === 'user' && !candidate.isRebuiltContext) return index;
      }
      return -1;
    };
    const handle: MessageViewportHandle = {
      isAtEnd: threshold => virtualizer.isAtEnd(threshold),
      scrollToEnd: behavior => virtualizer.scrollToEnd({ behavior }),
      scrollToMessage: (messageId, align = 'start', behavior = 'smooth') => {
        const index = findMessageIndex(messageId);
        if (index >= 0) virtualizer.scrollToIndex(index + boundaryCount, { align, behavior });
      },
      scrollToRecentUser: (messageId) => {
        const index = findMessageIndex(messageId);
        const target = findUserIndex(index - 1, 'prev');
        if (target >= 0) virtualizer.scrollToIndex(target + boundaryCount, { align: 'start', behavior: 'smooth' });
      },
      scrollToStart: behavior => virtualizer.scrollToIndex(boundaryCount, { align: 'start', behavior }),
      scrollToUser: (direction) => {
        const range = virtualizer.range;
        const start = direction === 'prev'
          ? (range?.startIndex ?? messageIds.length) - boundaryCount - 1
          : (range?.endIndex ?? boundaryCount - 1) - boundaryCount + 1;
        const target = findUserIndex(start, direction);
        if (target >= 0) virtualizer.scrollToIndex(target + boundaryCount, { align: 'start', behavior: 'smooth' });
      },
    };
    onViewportHandle?.(handle);
    return () => onViewportHandle?.(null);
  }, [boundaryCount, messageIds, onViewportHandle, store, virtualizer]);

  useLayoutEffect(() => {
    const recorder = store.perfRecorder;
    const root = listRef.current;
    const ownerWindow = scrollElement.ownerDocument.defaultView;
    if (!recorder.enabled || !root || !ownerWindow) return;
    recorder.onVirtualRows(
      root.querySelectorAll('.pivi-message-virtual-row').length,
      root.querySelectorAll('*').length + 1,
      ownerWindow,
    );

    const pendingAnchor = pendingAnchorRef.current;
    if (!pendingAnchor) return;
    pendingAnchorRef.current = null;
    if (pendingAnchorFrameRef.current !== null) {
      ownerWindow.cancelAnimationFrame(pendingAnchorFrameRef.current);
    }
    pendingAnchorFrameRef.current = ownerWindow.requestAnimationFrame(() => {
      pendingAnchorFrameRef.current = null;
      const anchor = Array.from(root.children).find(element => (
        element.instanceOf(HTMLElement)
        && element.dataset.itemKey === pendingAnchor.id
      ));
      if (!anchor?.instanceOf(HTMLElement)) return;
      recorder.onScrollAnchor(
        pendingAnchor.id,
        anchor.getBoundingClientRect().top - pendingAnchor.top,
        ownerWindow,
      );
    });
  }, [scrollElement, store, virtualItems]);

  useLayoutEffect(() => () => {
    const ownerWindow = scrollElement.ownerDocument.defaultView;
    if (ownerWindow && pendingAnchorFrameRef.current !== null) {
      ownerWindow.cancelAnimationFrame(pendingAnchorFrameRef.current);
    }
    if (ownerWindow && streamingFollowFrameRef.current !== null) {
      ownerWindow.cancelAnimationFrame(streamingFollowFrameRef.current);
    }
    pendingAnchorFrameRef.current = null;
    streamingFollowFrameRef.current = null;
  }, [scrollElement]);

  if (count === 0) {
    return (
      <DisclosureAnchorProvider beginDisclosureResize={beginDisclosureResize}>
        <div className="pivi-message-list" ref={listRef} />
      </DisclosureAnchorProvider>
    );
  }

  return (
    <DisclosureAnchorProvider beginDisclosureResize={beginDisclosureResize}>
      <div
        className="pivi-message-list pivi-message-list-virtual"
        ref={listRef}
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
      >
        {virtualItems.map((virtualItem) => {
        const isHistoryBoundary = hasOlderMessages && virtualItem.index === 0;
        const messageIndex = virtualItem.index - boundaryCount;
        const messageId = messageIds[messageIndex];
        const streamingRowStart = streamingTurnStart + boundaryCount;
        return (
          <div
            className="pivi-message-virtual-row"
            data-index={virtualItem.index}
            data-item-key={String(virtualItem.key)}
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            style={{
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualItem.start}px)`,
              width: '100%',
            }}
          >
            {isHistoryBoundary
              ? <MemoryBoundary kind="older-history" />
              : messageId
              ? (
                <ProjectedMessageRow
                  actions={actions}
                  contentAdapters={contentAdapters}
                  hideActions={virtualItem.index >= streamingRowStart}
                  isStreaming={isStreaming && virtualItem.index >= streamingRowStart}
                  messageId={messageId}
                  store={store}
                />
              )
              : <StreamingThinkingRow indicator={thinkingIndicator} />}
          </div>
        );
        })}
      </div>
    </DisclosureAnchorProvider>
  );
}
