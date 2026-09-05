import type { SessionStore } from '@pivi/agent/session';
import type { SessionJournalStore } from '@pivi/agent/session/sessionJournal';

import {
  cleanupEmptySessionsAtStartup,
  EMPTY_SESSION_STARTUP_MIN_AGE_MS,
} from '@/app/emptySessionCleanup';

function createJournal(owned: string[] = []): SessionJournalStore {
  return {
    load: () => ({
      version: 1,
      entries: owned.map((sessionFile) => ({
        sessionFile,
        status: 'pending',
      })),
      recoveredIdentities: {},
    }),
    save: () => undefined,
  } as unknown as SessionJournalStore;
}

describe('cleanupEmptySessionsAtStartup', () => {
  const now = 10_000_000;

  it('permanently discards stale empty files and archived bindings, not Deleted', async () => {
    const deleteSession = jest.fn(async () => undefined);
    const setTabManagerState = jest.fn(async () => undefined);
    const result = await cleanupEmptySessionsAtStartup({
      now,
      vaultPath: '/vault',
      sessionStore: {
        listSessions: async () => [
          {
            sessionFile: '.pivi/sessions/stale.jsonl',
            sessionId: 'stale',
            title: 'Sep 5',
            updatedAt: 1,
            leafCount: 1,
            messagePreview: 'New session',
            hasPersistedUserMessage: false,
            mtimeMs: now - EMPTY_SESSION_STARTUP_MIN_AGE_MS,
          },
          {
            sessionFile: '.pivi/sessions/user.jsonl',
            sessionId: 'user',
            title: 'Keep',
            updatedAt: 1,
            leafCount: 1,
            messagePreview: 'hello',
            hasPersistedUserMessage: true,
            mtimeMs: now - EMPTY_SESSION_STARTUP_MIN_AGE_MS * 2,
          },
          {
            sessionFile: '.pivi/sessions/fresh.jsonl',
            sessionId: 'fresh',
            title: 'New',
            updatedAt: 1,
            leafCount: 1,
            messagePreview: 'New session',
            hasPersistedUserMessage: false,
            mtimeMs: now - EMPTY_SESSION_STARTUP_MIN_AGE_MS + 1,
          },
          {
            sessionFile: '.pivi/sessions/live.jsonl',
            sessionId: 'live',
            title: 'Live',
            updatedAt: 1,
            leafCount: 1,
            messagePreview: 'New session',
            hasPersistedUserMessage: false,
            mtimeMs: now - EMPTY_SESSION_STARTUP_MIN_AGE_MS * 2,
          },
          {
            sessionFile: '.pivi/sessions/journal.jsonl',
            sessionId: 'journal',
            title: 'Journal',
            updatedAt: 1,
            leafCount: 1,
            messagePreview: 'New session',
            hasPersistedUserMessage: false,
            mtimeMs: now - EMPTY_SESSION_STARTUP_MIN_AGE_MS * 2,
          },
        ],
        deleteSession,
      } as unknown as SessionStore,
      journalStore: createJournal(['.pivi/sessions/journal.jsonl']),
      getTabManagerState: async () => ({
        openTabs: [
          { tabId: 'archived', sessionFile: '.pivi/sessions/stale.jsonl', isArchived: true },
          { tabId: 'open', sessionFile: '.pivi/sessions/live.jsonl', isArchived: false },
        ],
        activeTabId: 'open',
      }),
      setTabManagerState,
    });

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith('.pivi/sessions/stale.jsonl');
    expect(result).toEqual({ removedFiles: 1, removedArchivedBindings: 1 });
    expect(setTabManagerState).toHaveBeenCalledWith({
      openTabs: [{ tabId: 'open', sessionFile: '.pivi/sessions/live.jsonl', isArchived: false }],
      activeTabId: 'open',
    });
  });
});
