import { useCallback, useSyncExternalStore } from 'react';

import type { ChatUiSnapshot, ChatUiSnapshotKey } from '../store';
import type { ActiveChatUiBridge } from './activeChatUiBridge';

/**
 * Subscribes to the active tab bridge and re-renders only when one of the
 * requested snapshot keys changes (or when the active store/targets swap).
 */
export function useActiveChatUiSlice(
  bridge: ActiveChatUiBridge,
  keys: readonly ChatUiSnapshotKey[],
): ChatUiSnapshot {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return bridge.subscribe((changedKeys) => {
      if (changedKeys.size === 0) {
        onStoreChange();
        return;
      }
      for (const key of keys) {
        if (changedKeys.has(key)) {
          onStoreChange();
          return;
        }
      }
    });
  }, [bridge, keys]);

  return useSyncExternalStore(
    subscribe,
    bridge.getSnapshot,
    bridge.getSnapshot,
  );
}
