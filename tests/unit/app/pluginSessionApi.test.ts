import type { OpenSessionState } from '@pivi/agent/runtime';

import type { PiviChatView } from '@/app/hostContracts';
import {
  deleteSession,
  type PluginSessionContext,
  purgeExpiredDeletedSessionFiles,
  purgeDeletedSessionFiles,
  restoreDeletedSession,
} from '@/app/pluginSessionApi';
import { readSessionTranscript } from '@/app/sessionTranscript';

function createView(overrides: {
  resetSession?: jest.Mock<Promise<void>, [string]>;
  boundSessionFiles?: string[];
} = {}): PiviChatView {
  const resetSession = overrides.resetSession ?? jest.fn(async () => undefined);
  return {
    leaf: {} as never,
    getChatHandle: () => ({
      commands: {} as never,
      maintenance: {
        resetSession,
        getBoundSessionFiles: () => [...(overrides.boundSessionFiles ?? [])],
      } as never,
    }),
  };
}

function createQueueStorage(initial: Array<{ sessionFile: string; deletedAt: number }> = []) {
  let records = [...initial];
  const getDeletedSessionFiles = jest.fn(async () => [...records]);
  const setDeletedSessionFiles = jest.fn(async (next: typeof records) => {
    records = [...next];
  });
  const updateDeletedSessionFiles = jest.fn(async (
    update: (current: readonly typeof records[number][]) => typeof records,
  ) => {
    records = update(records);
  });
  return {
    getDeletedSessionFiles,
    setDeletedSessionFiles,
    updateDeletedSessionFiles,
    getTabManagerState: jest.fn(async () => null),
    snapshot: () => [...records],
  };
}

function createContext(overrides: Partial<PluginSessionContext> = {}): PluginSessionContext {
  return {
    sessionManager: {
      delete: jest.fn(async () => null),
      getSync: jest.fn(() => null),
    } as never,
    requireSessionStore: () => ({
      deleteSession: jest.fn(async () => undefined),
    }) as never,
    storage: createQueueStorage(),
    getSessionList: () => [],
    getAllViews: () => [],
    setSessions: jest.fn(),
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
    const storage = createQueueStorage();
    const context = createContext({
      sessionManager: {
        getSync: jest.fn(() => deleted),
        delete: jest.fn(async () => deleted),
      } as never,
      storage,
      getAllViews: () => [
        createView({ resetSession: firstReset }),
        createView({ resetSession: secondReset }),
      ],
    });

    await deleteSession(context, 'session-1');

    expect(storage.updateDeletedSessionFiles).toHaveBeenCalled();
    expect(storage.snapshot()).toEqual([
      expect.objectContaining({ sessionFile: '.pivi/sessions/deleted.jsonl' }),
    ]);
    expect(firstReset).toHaveBeenCalledWith('session-1');
    expect(secondReset).toHaveBeenCalledWith('session-1');
  });

  it('does not remove an open session when its recovery record cannot be saved', async () => {
    const session = {
      id: 'session-1',
      sessionFile: '.pivi/sessions/deleted.jsonl',
    } as OpenSessionState;
    const remove = jest.fn(async () => session);
    const storage = createQueueStorage();
    storage.updateDeletedSessionFiles.mockRejectedValue(new Error('save failed'));
    const context = createContext({
      sessionManager: {
        getSync: jest.fn(() => session),
        delete: remove,
      } as never,
      storage,
    });

    await expect(deleteSession(context, session.id)).rejects.toThrow('save failed');
    expect(remove).not.toHaveBeenCalled();
  });

  it('protects session files bound by a live semantic view handle during purge', async () => {
    const deleteSessionFile = jest.fn(async () => undefined);
    const boundFile = '.pivi/sessions/bound.jsonl';
    const staleFile = '.pivi/sessions/stale.jsonl';
    const storage = createQueueStorage([
      { sessionFile: boundFile, deletedAt: 1 },
      { sessionFile: staleFile, deletedAt: 1 },
    ]);
    const context = createContext({
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
      storage,
      getAllViews: () => [createView({ boundSessionFiles: [boundFile] })],
    });

    await expect(purgeDeletedSessionFiles(context)).resolves.toBe(1);
    expect(deleteSessionFile).toHaveBeenCalledTimes(1);
    expect(deleteSessionFile).toHaveBeenCalledWith(staleFile);
    expect(storage.snapshot()).toEqual([
      { sessionFile: boundFile, deletedAt: 1 },
    ]);
  });

  it('purges only records whose individual retention window has expired', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 40 * day;
    const expiredFile = '.pivi/sessions/expired.jsonl';
    const recentFile = '.pivi/sessions/recent.jsonl';
    const deleteSessionFile = jest.fn(async () => undefined);
    const storage = createQueueStorage([
      { sessionFile: expiredFile, deletedAt: now - 30 * day },
      { sessionFile: recentFile, deletedAt: now - 30 * day + 1 },
    ]);
    const context = createContext({
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
      storage,
    });

    await expect(purgeExpiredDeletedSessionFiles(context, 30, now)).resolves.toBe(1);
    expect(deleteSessionFile).toHaveBeenCalledWith(expiredFile);
    expect(storage.snapshot()).toEqual([
      { sessionFile: recentFile, deletedAt: now - 30 * day + 1 },
    ]);
  });

  it('restores a queued JSONL before removing its deletion record', async () => {
    const sessionFile = '.pivi/sessions/recoverable.jsonl';
    const restored = {
      id: 'session-restored',
      title: 'Recovered session',
      sessionFile,
    } as OpenSessionState;
    const openByFile = jest.fn(async () => restored);
    const storage = createQueueStorage([
      { sessionFile, deletedAt: 123 },
      { sessionFile: '.pivi/sessions/other.jsonl', deletedAt: 456 },
    ]);
    const context = createContext({
      sessionManager: { openByFile } as never,
      storage,
    });

    await expect(restoreDeletedSession(context, sessionFile)).resolves.toBe(restored);
    expect(openByFile).toHaveBeenCalledWith(sessionFile);
    expect(storage.snapshot()).toEqual([
      { sessionFile: '.pivi/sessions/other.jsonl', deletedAt: 456 },
    ]);
    expect(openByFile.mock.invocationCallOrder[0]).toBeLessThan(
      storage.updateDeletedSessionFiles.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not open a session that is not queued for recovery', async () => {
    const openByFile = jest.fn();
    const context = createContext({
      sessionManager: { openByFile } as never,
    });

    await expect(restoreDeletedSession(context, '.pivi/sessions/not-deleted.jsonl'))
      .rejects.toThrow('Session is not queued for recovery');
    expect(openByFile).not.toHaveBeenCalled();
  });

  it('commits recovery before attempting to open the visible tab', async () => {
    const sessionFile = '.pivi/sessions/recoverable.jsonl';
    const storage = createQueueStorage([{ sessionFile, deletedAt: 123 }]);
    const context = createContext({
      sessionManager: {
        openByFile: jest.fn(async () => ({ id: 'session-1', sessionFile }) as OpenSessionState),
      } as never,
      storage,
    });

    await expect(restoreDeletedSession(context, sessionFile, async () => {
      throw new Error('view unavailable');
    })).rejects.toThrow('view unavailable');
    expect(storage.snapshot()).toEqual([]);
  });

  it('retains invalid queued paths instead of passing them to physical deletion', async () => {
    const invalid = 'notes/important.md';
    const deleteSessionFile = jest.fn(async () => undefined);
    const storage = createQueueStorage([{ sessionFile: invalid, deletedAt: 1 }]);
    const context = createContext({
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
      storage,
    });

    await expect(purgeDeletedSessionFiles(context)).resolves.toBe(0);
    expect(deleteSessionFile).not.toHaveBeenCalled();
    expect(storage.updateDeletedSessionFiles).not.toHaveBeenCalled();
    expect(storage.snapshot()).toEqual([{ sessionFile: invalid, deletedAt: 1 }]);
  });

  it('keeps both concurrent delete marks when each starts from an empty queue', async () => {
    const first = {
      id: 'session-a',
      sessionFile: '.pivi/sessions/a.jsonl',
    } as OpenSessionState;
    const second = {
      id: 'session-b',
      sessionFile: '.pivi/sessions/b.jsonl',
    } as OpenSessionState;
    const storage = createQueueStorage();
    // Simulate the pre-fix lost-update race: two callers read empty, then write.
    // The atomic updater always sees the latest committed queue.
    let gate: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { gate = resolve; });
    let inFlight = 0;
    storage.updateDeletedSessionFiles.mockImplementation(async (update) => {
      inFlight += 1;
      if (inFlight === 1) {
        await release;
      }
      const current = storage.snapshot();
      const next = update(current);
      await storage.setDeletedSessionFiles(next);
    });

    const contextA = createContext({
      sessionManager: {
        getSync: jest.fn(() => first),
        delete: jest.fn(async () => first),
      } as never,
      storage,
    });
    const contextB = createContext({
      sessionManager: {
        getSync: jest.fn(() => second),
        delete: jest.fn(async () => second),
      } as never,
      storage,
    });

    const pendingA = deleteSession(contextA, first.id);
    await Promise.resolve();
    const pendingB = deleteSession(contextB, second.id);
    await Promise.resolve();
    gate?.();
    await Promise.all([pendingA, pendingB]);

    const files = storage.snapshot().map((record) => record.sessionFile).sort();
    expect(files).toEqual([
      '.pivi/sessions/a.jsonl',
      '.pivi/sessions/b.jsonl',
    ]);
  });
});
