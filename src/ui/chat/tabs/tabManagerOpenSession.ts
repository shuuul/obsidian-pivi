import type { TabData, TabId } from './types';

/** Narrow deps for opening a session into TabManager tabs. */
export type TabManagerOpenSessionDeps = {
  tabs: Iterable<TabData>;
  activateOpenSessionElsewhere: (openSessionId: string) => Promise<boolean>;
  switchToTab: (tabId: TabId) => Promise<void>;
  canCreateTab: () => boolean;
  createTab: (
    openSessionId: string,
    tabId: undefined,
    options: { activate: boolean },
  ) => Promise<TabData | null>;
  getActiveTab: () => TabData | null;
};

/**
 * Opens an open session in an existing tab, another view, or a new/current tab.
 */
export async function openSessionInTabManager(
  deps: TabManagerOpenSessionDeps,
  openSessionId: string,
  options: { preferNewTab?: boolean; activate?: boolean } = {},
): Promise<void> {
  const preferNewTab = options.preferNewTab ?? false;
  const activate = options.activate ?? true;

  for (const tab of deps.tabs) {
    if (tab.openSessionId === openSessionId) {
      await deps.switchToTab(tab.id);
      const needsHydrate = tab.state.messages.length === 0;
      if (needsHydrate) {
        await tab.controllers.openSessionController?.switchTo(openSessionId);
      }
      return;
    }
  }

  if (await deps.activateOpenSessionElsewhere(openSessionId)) {
    return;
  }

  if (preferNewTab && deps.canCreateTab()) {
    await deps.createTab(openSessionId, undefined, { activate });
  } else {
    // Note: Don't set tab.openSessionId here - the onOpenSessionIdChanged callback
    // will sync it after successful switch. Setting it before switchTo() would cause
    // incorrect tab metadata if switchTo() returns early (streaming/switching/creating).
    const activeTab = deps.getActiveTab();
    if (activeTab) {
      await activeTab.controllers.openSessionController?.switchTo(openSessionId);
    }
  }
}
