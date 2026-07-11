import type { SessionEntry } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

export type VisibleConversationRole = 'user' | 'assistant';

export function findLastVisibleConversationEntryId(
  entries: SessionEntry[],
  role?: VisibleConversationRole,
): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.type !== 'message') {
      continue;
    }
    const entryRole = entry.message.role;
    if (role ? entryRole === role : entryRole === 'user' || entryRole === 'assistant') {
      return entry.id;
    }
  }
  return null;
}
