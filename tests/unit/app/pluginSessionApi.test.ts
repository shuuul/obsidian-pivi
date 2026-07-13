import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';

import type { PiviChatView } from '@/app/hostContracts';
import {
  deleteSession,
  type PluginSessionContext,
  purgeDeletedSessionFiles,
} from '@/app/pluginSessionApi';

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

function createContext(overrides: Partial<PluginSessionContext> = {}): PluginSessionContext {
  return {
    sessionManager: {
      delete: jest.fn(async () => null),
    } as never,
    requireSessionStore: () => ({
      deleteSession: jest.fn(async () => undefined),
    }) as never,
    storage: {
      getDeletedSessionFiles: jest.fn(async () => []),
      setDeletedSessionFiles: jest.fn(async () => undefined),
      getTabManagerState: jest.fn(async () => null),
    },
    getSessionList: () => [],
    getAllViews: () => [],
    setSessions: jest.fn(),
    getSessions: () => [],
    ...overrides,
  };
}

describe('plugin session API semantic view maintenance', () => {
  it('resets a deleted open session through every mounted view handle', async () => {
    const firstReset = jest.fn(async (_openSessionId: string) => undefined);
    const secondReset = jest.fn(async (_openSessionId: string) => undefined);
    const deleted = {
      id: 'session-1',
      sessionFile: '.pivi/sessions/deleted.jsonl',
    } as OpenSessionState;
    const setDeletedSessionFiles = jest.fn(async () => undefined);
    const context = createContext({
      sessionManager: {
        delete: jest.fn(async () => deleted),
      } as never,
      storage: {
        getDeletedSessionFiles: jest.fn(async () => []),
        setDeletedSessionFiles,
        getTabManagerState: jest.fn(async () => null),
      },
      getAllViews: () => [
        createView({ resetSession: firstReset }),
        createView({ resetSession: secondReset }),
      ],
    });

    await deleteSession(context, 'session-1');

    expect(setDeletedSessionFiles).toHaveBeenCalledWith([
      '.pivi/sessions/deleted.jsonl',
    ]);
    expect(firstReset).toHaveBeenCalledWith('session-1');
    expect(secondReset).toHaveBeenCalledWith('session-1');
  });

  it('protects session files bound by a live semantic view handle during purge', async () => {
    const deleteSessionFile = jest.fn(async () => undefined);
    const setDeletedSessionFiles = jest.fn(async () => undefined);
    const boundFile = '.pivi/sessions/bound.jsonl';
    const staleFile = '.pivi/sessions/stale.jsonl';
    const context = createContext({
      requireSessionStore: () => ({ deleteSession: deleteSessionFile }) as never,
      storage: {
        getDeletedSessionFiles: jest.fn(async () => [boundFile, staleFile]),
        setDeletedSessionFiles,
        getTabManagerState: jest.fn(async () => null),
      },
      getAllViews: () => [createView({ boundSessionFiles: [boundFile] })],
    });

    await expect(purgeDeletedSessionFiles(context)).resolves.toBe(1);
    expect(deleteSessionFile).toHaveBeenCalledTimes(1);
    expect(deleteSessionFile).toHaveBeenCalledWith(staleFile);
    expect(setDeletedSessionFiles).toHaveBeenCalledWith([boundFile]);
  });
});
