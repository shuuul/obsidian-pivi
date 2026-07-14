import type { ChatTabSnapshotItem } from '../../store';

export function dotClass(item: ChatTabSnapshotItem): string {
  if (item.isStreaming) return ' is-live';
  if (item.needsAttention) return ' is-unread';
  return '';
}

export function getFallbackItem(items: readonly ChatTabSnapshotItem[], tabId: string) {
  const openItems = items.filter(item => !item.isArchived);
  const openIndex = openItems.findIndex(item => item.id === tabId);
  if (openIndex >= 0) return openItems[openIndex - 1] ?? openItems[openIndex + 1] ?? null;
  const index = items.findIndex(item => item.id === tabId);
  return items[index - 1] ?? items[index + 1] ?? null;
}
