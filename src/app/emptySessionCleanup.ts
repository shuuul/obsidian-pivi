/**
 * Startup cleanup of durable sessions that never received a persisted user message.
 * Runs after session-journal recovery and before tab reconciliation.
 */
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { SessionStore } from '@pivi/agent/session';
import type { SessionJournalStore } from '@pivi/agent/session/sessionJournal';
import type { AppTabManagerState } from '@pivi/obsidian-host/bootstrap/types';

const logger = new PluginLogger('EmptySessionCleanup');
export const EMPTY_SESSION_STARTUP_MIN_AGE_MS = 60 * 60 * 1000;

export interface EmptySessionCleanupResult {
  removedFiles: number;
  removedArchivedBindings: number;
}

function journalOwnedSessionFiles(journal: SessionJournalStore): Set<string> {
  const owned = new Set<string>();
  const state = journal.load();
  for (const entry of state.entries) {
    if (entry.status === 'intent' || entry.status === 'pending') {
      owned.add(entry.sessionFile);
    }
  }
  return owned;
}

function liveSessionFiles(tabState: AppTabManagerState | null): Set<string> {
  const live = new Set<string>();
  for (const tab of tabState?.openTabs ?? []) {
    if (tab.sessionFile && tab.isArchived !== true) {
      live.add(tab.sessionFile);
    }
  }
  return live;
}

export async function cleanupEmptySessionsAtStartup(options: {
  sessionStore: SessionStore;
  vaultPath: string;
  journalStore: SessionJournalStore;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  now?: number;
}): Promise<EmptySessionCleanupResult> {
  const now = options.now ?? Date.now();
  const tabState = await options.getTabManagerState();
  const journalOwned = journalOwnedSessionFiles(options.journalStore);
  const live = liveSessionFiles(tabState);
  const summaries = await options.sessionStore.listSessions(options.vaultPath);
  const removed = new Set<string>();

  for (const summary of summaries) {
    if (summary.hasPersistedUserMessage !== false) continue;
    if (journalOwned.has(summary.sessionFile)) continue;
    if (live.has(summary.sessionFile)) continue;
    const mtimeMs = summary.mtimeMs;
    if (typeof mtimeMs !== 'number' || now - mtimeMs < EMPTY_SESSION_STARTUP_MIN_AGE_MS) continue;
    try {
      await options.sessionStore.deleteSession(summary.sessionFile);
      removed.add(summary.sessionFile);
    } catch (error) {
      logger.warn(`Failed to discard empty session ${summary.sessionFile}`, error);
    }
  }

  let removedArchivedBindings = 0;
  if (removed.size > 0 && tabState) {
    const openTabs = tabState.openTabs.filter((tab) => {
      if (!tab.sessionFile || !removed.has(tab.sessionFile)) return true;
      if (tab.isArchived === true) {
        removedArchivedBindings += 1;
        return false;
      }
      return true;
    });
    if (openTabs.length !== tabState.openTabs.length) {
      const activeTabId = openTabs.some((tab) => tab.tabId === tabState.activeTabId)
        ? tabState.activeTabId
        : (openTabs.find((tab) => tab.isArchived !== true)?.tabId ?? openTabs[0]?.tabId ?? null);
      await options.setTabManagerState({ openTabs, activeTabId });
    }
  }

  return {
    removedFiles: removed.size,
    removedArchivedBindings,
  };
}
