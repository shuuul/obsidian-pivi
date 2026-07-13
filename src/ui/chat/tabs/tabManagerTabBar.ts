import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';

import { getTabTitle } from './Tab';
import type { TabBarItem, TabData, TabId } from './types';

/** Builds open-then-archived tab bar items for the React strip. */
export function getTabBarItems(
  tabs: Iterable<TabData>,
  activeTabId: TabId | null,
  tabCount: number,
  sessions: ChatPorts['sessions'],
): TabBarItem[] {
  const openItems: TabBarItem[] = [];
  const archivedItems: TabBarItem[] = [];
  let index = 1;

  for (const tab of tabs) {
    const item = {
      id: tab.id,
      index: index++,
      title: getTabTitle(tab, sessions),
      isActive: tab.id === activeTabId,
      isStreaming: tab.state.isStreaming,
      needsAttention: tab.state.needsAttention,
      isArchived: tab.isArchived,
      canClose: tabCount > 1 || !tab.state.isStreaming,
    };
    if (tab.isArchived) {
      archivedItems.push(item);
    } else {
      openItems.push(item);
    }
  }

  return [...openItems, ...archivedItems];
}
