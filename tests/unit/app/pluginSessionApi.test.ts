import type { OpenSessionState } from '@pivi/agent/runtime';
import type { AppTabManagerState } from '@pivi/obsidian-host/bootstrap/types';

import type { PiviChatView } from '@/app/hostContracts';
import {
  deleteSession,
  discardSessionFile,
  type PluginSessionContext,
  purgeExpiredDeletedSessionFiles,
  purgeDeletedSessionFiles,
  restoreDeletedSession,
  getSessionMaintenanceSnapshot,
  deleteAllArchivedChats,
  abandonEmptyOwnedSession,
} from '@/app/pluginSessionApi';
import { readSessionTranscript } from '@/app/sessionTranscript';

function createView(overrides: {
  resetSession?: jest.Mock<Promise<void>, [string]>;
  boundSessionFiles?: string[];
  sessionBindings?: Array<{ sessionFile: string; archived: boolean }>;
  removeArchivedBindings?: jest.Mock<Promise<void>, [string]>;
} = {}): PiviChatView {
  const resetSession = overrides.resetSession ?? jest.fn(async () => undefined);
  return {
    leaf: {} as never,
    getChatHandle: () => ({
      commands: {} as never,
      maintenance: {
        resetSession,
        getBoundSessionFiles: () => [...(overrides.boundSessionFiles ?? [])],
        getSessionBindings: () => [...(overrides.sessionBindings ?? [])],
        removeArchivedBindings: overrides.removeArchivedBindings ?? jest.fn(async () => undefined),
      } as never,
    }),
  };
}

function createTabStorage(tabState: AppTabManagerState | null = null) {
  return {
    getTabManagerState: jest.fn(async (): Promise<AppTabManagerState | null> => tabState),
    setTabManagerState: jest.fn(async () => undefined),
  };
}

function createTrashStore(initial: Array<{ sessionFile: string; deletedAt: number }> = []) {
  const trashed = new Map(initial.map((record) => [record.sessionFile, record.deletedAt]));
  return {
    trashSession: jest.fn(async (sessionFile: string) => {
      if (!trashed.has(sessionFile)) {
        trashed.set(sessionFile, Date.now());
      }
    }),
    listTrashedSessions: jest.fn(async () => (
      [...trashed.entries()].map(([sessionFile, deletedAt]) => ({ sessionFile, deletedAt }))
    )),
    restoreTrashedSession: jest.fn(async (sessionFile: string) => {
      if (!trashed.delete(sessionFile)) {
        throw new Error(`Deleted session file is missing: ${sessionFile}`);
      }
    }),
    purgeTrashedSession: jest.fn(async (sessionFile: string) => {
      trashed.delete(sessionFile);
    }),
    deleteSession: jest.fn(async () => undefined),
    snapshot: () => [...trashed.entries()].map(([sessionFile, deletedAt]) => ({ sessionFile, deletedAt })),
  };
}

function createContext(overrides: Partial<PluginSessionContext> = {}): PluginSessionContext {
  const trashStore = createTrashStore();
  return {
    sessionManager: {
      delete: jest.fn(async () => null),
      getSync: jest.fn(() => null),
    } as never,
    requireSessionStore: () => trashStore as never,
    storage: createTabStorage(),
    getSessionList: () => [],
    getAllViews: () => [],
    getSessions: () => [],
    ...overrides,
  };
}

describe('plugin session API semantic view maintenance', () => {
  it('formats a paged session as formal conversation only', async () => {
    const ref = {
      sessionId: 'session-1',
      sessionFile: '.pivi/sessions/one.jsonl',
    };
    const readOlder = jest.fn(async () => ({
      messages: [{
        id: 'rebuilt',
        role: 'user' as const,
        content: 'internal context',
        isRebuiltContext: true,
        timestamp: 1,
      }, {
        id: 'user-1',
        role: 'user' as const,
        content: 'Question',
        timestamp: 2,
      }],
      hasOlder: false,
      totalMessageCount: 4,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
    }));
    const transcript = await readSessionTranscript({
      sessionFile: ref.sessionFile,
      store: {
        open: jest.fn(async () => ref),
        openRecent: jest.fn(async () => ({
          messages: [{
            id: 'agent-1',
            role: 'assistant',
            content: 'fallback must not leak',
            contentBlocks: [
              { type: 'thinking', content: 'private reasoning' },
              { type: 'tool_use', toolId: 'tool-1' },
              { type: 'text', content: 'Answer' },
            ],
            timestamp: 3,
          }],
          hasOlder: true,
          totalMessageCount: 4,
          olderMessageCount: 2,
          olderUserMessageCount: 2,
        })),
        readOlder,
      } as never,
    });

    expect(transcript).toBe('## User\n\nQuestion\n\n## Agent\n\nAnswer');
    expect(transcript).not.toContain('private reasoning');
    expect(transcript).not.toContain('internal context');
    expect(readOlder).toHaveBeenCalledWith(ref, 'agent-1', 200);
  });

  it('resets a deleted open session through every mounted view handle', async () => {
    const firstReset = jest.fn(async (_openSessionId: string) => undefined);
    const secondReset = jest.fn(async (_openSessionId: string) => undefined);
    const deleted = {
      id: 'session-1',
      sessionFile: '.pivi/sessions/deleted.jsonl',
    } as OpenSessionState;
    const trashStore = createTrashStore();
    const context = createContext({
      sessionManager: {
        getSync: jest.fn(() => deleted),
        delete: jest.fn(async () => deleted),
      } as never,
      requireSessionStore: () => trashStore as never,
      getAllViews: () => [
        createView({ resetSession: firstReset }),
        createView({ resetSession: secondReset }),
      ],
    });

    await deleteSession(context, 'session-1');

    expect(trashStore.trashSession).toHaveBeenCalledWith('.pivi/sessions/deleted.jsonl');
    expect(trashStore.snapshot()).toEqual([
      expect.objectContaining({ sessionFile: '.pivi/sessions/deleted.jsonl' }),
    ]);
    expect(firstReset).toHaveBeenCalledWith('session-1');
    expect(secondReset).toHaveBeenCalledWith('session-1');
  });

  it('does not remove an open session when its file cannot be moved to trash', async () => {
    const session = {
      id: 'session-1',
      sessionFile: '.pivi/sessions/deleted.jsonl',
    } as OpenSessionState;
    const remove = jest.fn(async () => session);
    const trashStore = createTrashStore();
    trashStore.trashSession.mockRejectedValue(new Error('rename failed'));
    const context = createContext({
      sessionManager: {
        getSync: jest.fn(() => session),
        delete: remove,
      } as never,
      requireSessionStore: () => trashStore as never,
    });

    await expect(deleteSession(context, session.id)).rejects.toThrow('rename failed');
    expect(remove).not.toHaveBeenCalled();
  });

  it('physically discards a failed fork after removing its open registration', async () => {
    const events: string[] = [];
    const sessionFile = '.pivi/sessions/failed-fork.jsonl';
    const context = createContext({
      sessionManager: {
        delete: jest.fn(async () => {
          events.push('registration');
          return null;
        }),
      } as never,
      requireSessionStore: () => ({
        deleteSession: jest.fn(async () => {
          events.push('file');
        }),
      }) as never,
    });

    await discardSessionFile(context, sessionFile, 'fork-open');

    expect(events).toEqual(['registration', 'file']);
  });

  it('continues failed-fork file cleanup when registration cleanup fails', async () => {
    const removeFile = jest.fn(async () => undefined);
    const registrationError = new Error('registration failed');
    const context = createContext({
      sessionManager: {
        delete: jest.fn(async () => { throw registrationError; }),
      } as never,
      requireSessionStore: () => ({ deleteSession: removeFile }) as never,
    });

    await expect(discardSessionFile(
      context,
      '.pivi/sessions/failed-fork.jsonl',
      'fork-open',
    )).rejects.toMatchObject({ errors: [registrationError] });
    expect(removeFile).toHaveBeenCalledTimes(1);
  });

  it('protects session files bound by a live semantic view handle during purge', async () => {
    const boundFile = '.pivi/sessions/bound.jsonl';
    const staleFile = '.pivi/sessions/stale.jsonl';
    const trashStore = createTrashStore([
      { sessionFile: boundFile, deletedAt: 1 },
      { sessionFile: staleFile, deletedAt: 1 },
    ]);
    const context = createContext({
      requireSessionStore: () => trashStore as never,
      getAllViews: () => [createView({ boundSessionFiles: [boundFile] })],
    });

    await expect(purgeDeletedSessionFiles(context)).resolves.toBe(1);
    expect(trashStore.purgeTrashedSession).toHaveBeenCalledTimes(1);
    expect(trashStore.purgeTrashedSession).toHaveBeenCalledWith(staleFile);
    expect(trashStore.snapshot()).toEqual([
      { sessionFile: boundFile, deletedAt: 1 },
    ]);
  });

  it('purges only records whose individual retention window has expired', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 40 * day;
    const expiredFile = '.pivi/sessions/expired.jsonl';
    const recentFile = '.pivi/sessions/recent.jsonl';
    const trashStore = createTrashStore([
      { sessionFile: expiredFile, deletedAt: now - 30 * day },
      { sessionFile: recentFile, deletedAt: now - 30 * day + 1 },
    ]);
    const context = createContext({
      requireSessionStore: () => trashStore as never,
    });

    await expect(purgeExpiredDeletedSessionFiles(context, 30, now)).resolves.toBe(1);
    expect(trashStore.purgeTrashedSession).toHaveBeenCalledWith(expiredFile);
    expect(trashStore.snapshot()).toEqual([
      { sessionFile: recentFile, deletedAt: now - 30 * day + 1 },
    ]);
  });

  it('restores a trashed JSONL before opening it', async () => {
    const sessionFile = '.pivi/sessions/recoverable.jsonl';
    const restored = {
      id: 'session-restored',
      title: 'Recovered session',
      sessionFile,
    } as OpenSessionState;
    const openByFile = jest.fn(async () => restored);
    const trashStore = createTrashStore([
      { sessionFile, deletedAt: 123 },
      { sessionFile: '.pivi/sessions/other.jsonl', deletedAt: 456 },
    ]);
    const context = createContext({
      sessionManager: { openByFile } as never,
      requireSessionStore: () => trashStore as never,
    });

    await expect(restoreDeletedSession(context, sessionFile)).resolves.toBe(restored);
    expect(trashStore.restoreTrashedSession).toHaveBeenCalledWith(sessionFile);
    expect(openByFile).toHaveBeenCalledWith(sessionFile);
    expect(trashStore.snapshot()).toEqual([
      { sessionFile: '.pivi/sessions/other.jsonl', deletedAt: 456 },
    ]);
    expect(trashStore.restoreTrashedSession.mock.invocationCallOrder[0]).toBeLessThan(
      openByFile.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not open a session that is not in trash', async () => {
    const openByFile = jest.fn();
    const context = createContext({
      sessionManager: { openByFile } as never,
    });

    await expect(restoreDeletedSession(context, '.pivi/sessions/not-deleted.jsonl'))
      .rejects.toThrow('Session is not in trash');
    expect(openByFile).not.toHaveBeenCalled();
  });

  it('keeps the restored file out of trash even if the visible tab fails to open', async () => {
    const sessionFile = '.pivi/sessions/recoverable.jsonl';
    const trashStore = createTrashStore([{ sessionFile, deletedAt: 123 }]);
    const context = createContext({
      sessionManager: {
        openByFile: jest.fn(async () => ({ id: 'session-1', sessionFile }) as OpenSessionState),
      } as never,
      requireSessionStore: () => trashStore as never,
    });

    await expect(restoreDeletedSession(context, sessionFile, async () => {
      throw new Error('view unavailable');
    })).rejects.toThrow('view unavailable');
    expect(trashStore.snapshot()).toEqual([]);
  });

  it('retains invalid trash identities instead of passing them to physical deletion', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalid = 'notes/important.md';
    const trashStore = createTrashStore([{ sessionFile: invalid, deletedAt: 1 }]);
    const context = createContext({
      requireSessionStore: () => trashStore as never,
    });

    await expect(purgeDeletedSessionFiles(context)).resolves.toBe(0);
    expect(trashStore.purgeTrashedSession).not.toHaveBeenCalled();
    expect(trashStore.snapshot()).toEqual([{ sessionFile: invalid, deletedAt: 1 }]);
    expect(warning).toHaveBeenCalledWith(
      '[Pivi:PluginSessionApi] Refusing to purge invalid session path notes/important.md',
    );
  });

  it('trashes concurrent deletes independently', async () => {
    const first = {
      id: 'session-a',
      sessionFile: '.pivi/sessions/a.jsonl',
    } as OpenSessionState;
    const second = {
      id: 'session-b',
      sessionFile: '.pivi/sessions/b.jsonl',
    } as OpenSessionState;
    const trashStore = createTrashStore();
    const contextA = createContext({
      sessionManager: {
        getSync: jest.fn(() => first),
        delete: jest.fn(async () => first),
      } as never,
      requireSessionStore: () => trashStore as never,
    });
    const contextB = createContext({
      sessionManager: {
        getSync: jest.fn(() => second),
        delete: jest.fn(async () => second),
      } as never,
      requireSessionStore: () => trashStore as never,
    });

    await Promise.all([
      deleteSession(contextA, first.id),
      deleteSession(contextB, second.id),
    ]);

    expect(trashStore.snapshot().map((record) => record.sessionFile).sort()).toEqual([
      '.pivi/sessions/a.jsonl',
      '.pivi/sessions/b.jsonl',
    ]);
  });
});

describe('session maintenance inventory', () => {
  it('counts unique archived files and deleted records', async () => {
    const trashStore = createTrashStore([
      { sessionFile: '.pivi/sessions/deleted.jsonl', deletedAt: 1 },
    ]);
    const storage = createTabStorage({
      openTabs: [
        { tabId: 'a', sessionFile: '.pivi/sessions/one.jsonl', isArchived: true },
        { tabId: 'b', sessionFile: '.pivi/sessions/one.jsonl', isArchived: true },
        { tabId: 'c', sessionFile: '.pivi/sessions/open.jsonl', isArchived: false },
      ],
      activeTabId: 'c',
    });
    const snapshot = await getSessionMaintenanceSnapshot(createContext({
      storage,
      requireSessionStore: () => trashStore as never,
      getAllViews: () => [createView({
        sessionBindings: [{ sessionFile: '.pivi/sessions/two.jsonl', archived: true }],
      })],
    }));
    expect(snapshot).toEqual({ archivedCount: 2, deletedCount: 1 });
  });

  it('moves unique archived files to trash and skips files still open', async () => {
    const removeArchivedBindings = jest.fn(async (_sessionFile: string) => undefined);
    const trashStore = createTrashStore();
    const storage = createTabStorage({
      openTabs: [
        { tabId: 'archived', sessionFile: '.pivi/sessions/old.jsonl', isArchived: true },
        { tabId: 'open', sessionFile: '.pivi/sessions/live.jsonl', isArchived: false },
        { tabId: 'also-archived-live', sessionFile: '.pivi/sessions/live.jsonl', isArchived: true },
      ],
      activeTabId: 'open',
    });
    const result = await deleteAllArchivedChats(createContext({
      storage,
      requireSessionStore: () => trashStore as never,
      getAllViews: () => [createView({
        sessionBindings: [
          { sessionFile: '.pivi/sessions/old.jsonl', archived: true },
          { sessionFile: '.pivi/sessions/live.jsonl', archived: false },
        ],
        removeArchivedBindings,
      })],
    }));
    expect(result).toEqual({ moved: 1, skippedActive: 1, failed: 0 });
    expect(removeArchivedBindings).toHaveBeenCalledWith('.pivi/sessions/old.jsonl');
    expect(trashStore.snapshot()).toEqual([
      expect.objectContaining({ sessionFile: '.pivi/sessions/old.jsonl' }),
    ]);
  });

  it('abandons only owned empty sessions', async () => {
    const deleteSessionFile = jest.fn(async () => undefined);
    const unowned = createContext({
      sessionManager: {
        ownsEmptySessionFile: jest.fn(() => false),
        delete: jest.fn(),
        getSync: jest.fn(() => null),
      } as never,
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
    });
    expect(await abandonEmptyOwnedSession(unowned, '.pivi/sessions/other.jsonl')).toBe(false);
    expect(deleteSessionFile).not.toHaveBeenCalled();

    const owned = createContext({
      sessionManager: {
        ownsEmptySessionFile: jest.fn(() => true),
        delete: jest.fn(async () => null),
        getSync: jest.fn(() => null),
      } as never,
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
    });
    expect(await abandonEmptyOwnedSession(owned, '.pivi/sessions/owned.jsonl')).toBe(true);
    expect(deleteSessionFile).toHaveBeenCalledWith('.pivi/sessions/owned.jsonl');
  });
});
