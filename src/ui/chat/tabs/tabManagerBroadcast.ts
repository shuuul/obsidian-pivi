import type { PiChatService } from '@pivi/pivi-agent-core/runtime';

import type { TabData } from './types';

/**
 * Invokes `fn` on every initialized tab runtime, ignoring per-tab failures.
 */
export async function broadcastToTabs(
  tabs: Iterable<TabData>,
  fn: (service: PiChatService) => Promise<void>,
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const tab of tabs) {
    if (tab.service && tab.serviceInitialized) {
      promises.push(
        fn(tab.service).catch((error) => {
          // Silently ignore broadcast errors
          console.warn('Pivi: tab broadcast failed', error);
        })
      );
    }
  }

  await Promise.all(promises);
}
