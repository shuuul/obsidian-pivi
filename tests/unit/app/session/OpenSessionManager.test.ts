import type { SessionRef, SessionStore } from '@pivi/session';
import type { ChatMessage, OpenSessionState } from '@pivi/core';
import { OpenSessionManager } from '@pivi/session/OpenSessionManager';

const hydratedMessage: ChatMessage = {
  id: 'm1',
  role: 'user',
  content: 'hello',
  timestamp: 1,
};

function createOpenSession(overrides: Partial<OpenSessionState> = {}): OpenSessionState {
  return {
    id: 'conv-1',
    title: 'Test session',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'sdk-session',
    sessionFile: '.pivi/sessions/test.jsonl',
    leafId: null,
    messages: [],
    ...overrides,
  };
}

function createStore(): SessionStore & {
  open: jest.Mock<Promise<SessionRef>, [string, (string | null | undefined)?]>;
  getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
} {
  const store = {
    listSessions: jest.fn(),
    create: jest.fn(),
    open: jest.fn(async (sessionFile: string, _leafId?: string | null) => ({
      sessionFile,
      leafId: undefined,
      sessionId: 'sdk-session',
    })),
    listLeaves: jest.fn(),
    getMessages: jest.fn(async () => [hydratedMessage]),
    appendUserTurn: jest.fn(),
    appendAgentTurn: jest.fn(),
    setLeaf: jest.fn(),
    fork: jest.fn(),
    deleteSession: jest.fn(),
    readUiContext: jest.fn(async () => ({})),
    writeUiContext: jest.fn(),
    writeSessionMeta: jest.fn(),
    sessionRefFromOpenSession: jest.fn((openSession: OpenSessionState) => ({
      sessionFile: openSession.sessionFile!,
      leafId: openSession.leafId,
      sessionId: openSession.sessionId ?? openSession.id,
    })),
  };
  return store as unknown as SessionStore & {
    open: jest.Mock<Promise<SessionRef>, [string, (string | null | undefined)?]>;
    getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
  };
}

describe('OpenSessionManager linear hydration', () => {
  it('opens the full session without requesting a leaf', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1');

    expect(store.open).toHaveBeenCalledWith('.pivi/sessions/test.jsonl');
    expect(openSession?.leafId).toBeNull();
    expect(openSession?.messages).toEqual([hydratedMessage]);
  });

  it('ignores legacy explicit null leaf requests', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1', null);

    expect(store.open).toHaveBeenCalledWith('.pivi/sessions/test.jsonl');
    expect(openSession?.leafId).toBeNull();
    expect(openSession?.messages).toEqual([hydratedMessage]);
  });

  it('removes deleted sessions from history without deleting the JSONL file', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const deleted = await manager.delete('conv-1');

    expect(deleted?.sessionFile).toBe('.pivi/sessions/test.jsonl');
    expect(manager.getAll()).toEqual([]);
    expect(store.deleteSession).not.toHaveBeenCalled();
  });
});
