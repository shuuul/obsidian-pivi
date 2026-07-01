import type { SessionRef, SessionStore } from '../../../../src/core/session/types';
import type { ChatMessage, OpenSessionState } from '../../../../src/core/types';
import { OpenSessionManager } from '../../../../src/app/session/OpenSessionManager';

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
  open: jest.Mock<Promise<SessionRef>, [string, string | null | undefined]>;
  getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
} {
  const store = {
    listSessions: jest.fn(),
    create: jest.fn(),
    open: jest.fn(async (sessionFile: string, leafId?: string | null) => ({
      sessionFile,
      leafId: leafId === undefined ? 'visible-leaf' : leafId,
      sessionId: 'sdk-session',
    })),
    listLeaves: jest.fn(),
    getMessages: jest.fn(async (ref: SessionRef) => (
      ref.leafId === null ? [] : [hydratedMessage]
    )),
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
    open: jest.Mock<Promise<SessionRef>, [string, string | null | undefined]>;
    getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
  };
}

describe('OpenSessionManager hydration leaf selection', () => {
  it('uses the latest visible leaf when the stored leaf is null and no leaf was requested', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1');

    expect(store.open).toHaveBeenCalledWith('.pivi/sessions/test.jsonl', undefined);
    expect(openSession?.leafId).toBe('visible-leaf');
    expect(openSession?.messages).toEqual([hydratedMessage]);
  });

  it('preserves an explicit null leaf for rewind-to-root', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1', null);

    expect(store.open).toHaveBeenCalledWith('.pivi/sessions/test.jsonl', null);
    expect(openSession?.leafId).toBeNull();
    expect(openSession?.messages).toEqual([]);
  });
});
