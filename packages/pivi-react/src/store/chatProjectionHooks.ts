/** React bindings for ChatProjectionStore: order, message-structure, block, and tool subscriptions. */

import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import type {
  ProjectionListener,
  ProjectionMessage,
} from './chatProjectionEvents';
import type { ChatProjectionStore } from './chatProjectionStore';

export function useChatProjectionOrder(store: ChatProjectionStore): readonly string[] {
  return useSyncExternalStore(store.subscribeOrder, store.getOrderSnapshot, store.getOrderSnapshot);
}

export function useChatProjectionMessageStructure(
  store: ChatProjectionStore,
  messageId: string,
): ProjectionMessage | null {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeMessageStructure(messageId, listener),
    [messageId, store],
  );
  const getSnapshot = useCallback(
    () => store.getMessageStructureSnapshot(messageId),
    [messageId, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useChatProjectionBlock(store: ChatProjectionStore, blockId: string) {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeBlock(blockId, listener),
    [blockId, store],
  );
  const getSnapshot = useCallback(
    () => store.getBlockSnapshot(blockId),
    [blockId, store],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useChatProjectionTool(store: ChatProjectionStore, toolId: string) {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeTool(toolId, listener),
    [store, toolId],
  );
  const getSnapshot = useCallback(
    () => store.getToolSnapshot(toolId),
    [store, toolId],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useChatProjectionTools(
  store: ChatProjectionStore,
  toolIds: readonly string[],
) {
  const toolIdsKey = JSON.stringify(toolIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialized key intentionally stabilizes equal ID lists from rebuilt message snapshots
  const stableToolIds = useMemo(() => [...toolIds], [toolIdsKey]);
  const snapshotRef = useRef<readonly ReturnType<ChatProjectionStore['getToolSnapshot']>[]>([]);
  const subscribe = useCallback((listener: ProjectionListener) => {
    const unsubscribers = stableToolIds.map(toolId => store.subscribeTool(toolId, listener));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [stableToolIds, store]);
  const getSnapshot = useCallback(() => {
    const next = stableToolIds.map(toolId => store.getToolSnapshot(toolId));
    const previous = snapshotRef.current;
    if (
      previous.length === next.length
      && previous.every((entity, index) => entity === next[index])
    ) {
      return previous;
    }
    const snapshot = Object.freeze(next);
    snapshotRef.current = snapshot;
    return snapshot;
  }, [stableToolIds, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
