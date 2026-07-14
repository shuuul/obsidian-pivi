import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';

import type {
  PersistedTabManagerState,
  PersistedTabState,
  TabData,
  TabId,
} from './types';

const logger = new PluginLogger('TabManagerPersist');

type CreateTabForRestore = (
  openSessionId: undefined,
  tabId: TabId,
  options: {
    activate: false;
    draftModel?: string;
    draftTitle?: string;
    sessionFile?: string;
    isArchived?: boolean;
    needsAttention?: boolean;
  },
) => Promise<TabData | null>;

/** Narrow deps for TabManager restore flows. */
export type TabManagerPersistDeps = {
  createTab: CreateTabForRestore;
  switchToTab: (tabId: TabId) => Promise<void>;
  hasTab: (tabId: TabId) => boolean;
  getTab: (tabId: TabId) => TabData | null;
  getFirstTabId: () => TabId | null;
  getTabCount: () => number;
  setRestoringState: (value: boolean) => void;
  createDefaultTab: () => Promise<TabData | null>;
};

/** Serializes open tabs and the active tab id for plugin persistence. */
export function getPersistedState(
  tabs: Iterable<TabData>,
  activeTabId: TabId | null,
): PersistedTabManagerState {
  const openTabs: PersistedTabState[] = [];

  for (const tab of tabs) {
    openTabs.push({
      ...(tab.lifecycleState === 'blank' && tab.draftModel
        ? { draftModel: tab.draftModel }
        : {}),
      ...(tab.lifecycleState === 'blank' && tab.draftTitle
        ? { draftTitle: tab.draftTitle }
        : {}),
      tabId: tab.id,
      ...(tab.sessionFile ? { sessionFile: tab.sessionFile } : {}),
      ...(tab.isArchived ? { isArchived: true } : {}),
      ...(tab.state.needsAttention ? { needsAttention: true } : {}),
    });
  }

  return {
    openTabs,
    activeTabId,
  };
}

/**
 * Recreates tabs from persisted bindings, then activates the prior open tab
 * (or a fallback). Creates a blank tab when nothing restores.
 */
export async function restoreState(
  deps: TabManagerPersistDeps,
  state: PersistedTabManagerState,
): Promise<void> {
  deps.setRestoringState(true);
  try {
    for (const tabState of state.openTabs) {
      try {
        await deps.createTab(undefined, tabState.tabId, {
          activate: false,
          ...(typeof tabState.draftModel === 'string' ? { draftModel: tabState.draftModel } : {}),
          ...(typeof tabState.draftTitle === 'string' ? { draftTitle: tabState.draftTitle } : {}),
          ...(typeof tabState.sessionFile === 'string' ? { sessionFile: tabState.sessionFile } : {}),
          ...(tabState.isArchived ? { isArchived: true } : {}),
          ...(tabState.needsAttention ? { needsAttention: true } : {}),
        });
      } catch (error) {
        // Continue restoring other tabs
        logger.warn(`Failed to restore tab ${tabState.tabId}`, error);
      }
    }
  } finally {
    deps.setRestoringState(false);
  }

  const fallbackTabId = state.openTabs.find((tabState) => deps.hasTab(tabState.tabId) && !tabState.isArchived)?.tabId
    ?? state.openTabs.find((tabState) => deps.hasTab(tabState.tabId))?.tabId
    ?? deps.getFirstTabId();
  const activeTab = state.activeTabId ? deps.getTab(state.activeTabId) : null;
  const targetTabId = activeTab && !activeTab.isArchived
    ? state.activeTabId
    : fallbackTabId;

  // Switch to the previously active tab after all tabs are restored so background
  // restore does not warm the first restored tab by accident.
  if (targetTabId) {
    try {
      await deps.switchToTab(targetTabId);
    } catch (error) {
      // Ignore switch errors
      logger.warn(`Failed to switch to tab ${targetTabId} during restore`, error);
    }
  }

  if (deps.getTabCount() === 0) {
    await deps.createDefaultTab();
  }
}
