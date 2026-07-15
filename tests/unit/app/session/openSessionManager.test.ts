import {
  type SessionRef,
  SessionIndexStaleError,
  type SessionStore,
} from '@pivi/pivi-agent-core/session';
import type { ChatMessage, OpenSessionState, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { OpenSessionManager } from '@pivi/pivi-agent-core/session/openSessionManager';

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
  listSessions: jest.Mock;
  open: jest.Mock<Promise<SessionRef>, [string, (string | null | undefined)?]>;
  getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
  openRecent: jest.Mock;
  readOlder: jest.Mock;
  getUsage: jest.Mock<Promise<UsageInfo | null>, [SessionRef]>;
  appendMessageUiPatches: jest.Mock;
  writeSessionMeta: jest.Mock;
  writeUiContext: jest.Mock;
} {
  const store = {
    listSessions: jest.fn(),
    create: jest.fn(),
    open: jest.fn(async (sessionFile: string, _leafId?: string | null) => ({
      sessionFile,
      leafId: undefined,
      sessionId: 'sdk-session',
    })),
    getMessages: jest.fn(async () => [hydratedMessage]),
    openRecent: jest.fn(async () => ({
      messages: [hydratedMessage],
      hasOlder: true,
      totalMessageCount: 5_000,
      olderMessageCount: 4_999,
      olderUserMessageCount: 2_500,
    })),
    readOlder: jest.fn(async () => ({
      messages: [hydratedMessage],
      hasOlder: false,
      totalMessageCount: 5_000,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
    })),
    getUsage: jest.fn(async () => null),
    appendUserTurn: jest.fn(),
    appendAgentTurn: jest.fn(),
    appendMessageUiPatches: jest.fn(async (ref: SessionRef) => ref),
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
    listSessions: jest.Mock;
    open: jest.Mock<Promise<SessionRef>, [string, (string | null | undefined)?]>;
    getMessages: jest.Mock<Promise<ChatMessage[]>, [SessionRef]>;
    openRecent: jest.Mock;
    readOlder: jest.Mock;
    getUsage: jest.Mock<Promise<UsageInfo | null>, [SessionRef]>;
    appendMessageUiPatches: jest.Mock;
    writeSessionMeta: jest.Mock;
    writeUiContext: jest.Mock;
  };
}

describe('OpenSessionManager linear hydration', () => {
  it('routes bounded pages through the durable session ref without hydrating', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession({ messagePreview: 'durable first request' })]);

    await expect(manager.openRecent('conv-1', 100)).resolves.toMatchObject({
      hasOlder: true,
      totalMessageCount: 5_000,
    });
    await expect(manager.readOlder('conv-1', 'm1', 100)).resolves.toMatchObject({
      hasOlder: false,
      totalMessageCount: 5_000,
    });

    const ref = {
      sessionFile: '.pivi/sessions/test.jsonl',
      leafId: null,
      sessionId: 'sdk-session',
    };
    expect(store.openRecent).toHaveBeenCalledWith(ref, 100);
    expect(store.readOlder).toHaveBeenCalledWith(ref, 'm1', 100);
    expect(store.open).not.toHaveBeenCalled();
    expect(store.getMessages).not.toHaveBeenCalled();
    expect(manager.getSync('conv-1')).toEqual(expect.objectContaining({
      messages: [hydratedMessage],
      hasOlderMessages: false,
      totalMessageCount: 5_000,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
      messagePreview: 'durable first request',
    }));
    expect(manager.list()[0]).toEqual(expect.objectContaining({
      messageCount: 5_000,
      preview: 'durable first request',
    }));
  });

  it('returns null for a range request without an open durable session', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });

    await expect(manager.openRecent('missing', 100)).resolves.toBeNull();
    await expect(manager.readOlder('missing', 'm1', 100)).resolves.toBeNull();
    expect(store.openRecent).not.toHaveBeenCalled();
    expect(store.readOlder).not.toHaveBeenCalled();
  });

  it('restores a custom title in a new manager from the shared vault session store', async () => {
    const persisted = createOpenSession({ title: 'Initial title', titleSource: 'timestamp' });
    const summaries = () => [{
      sessionFile: persisted.sessionFile!,
      sessionId: persisted.sessionId!,
      title: persisted.title,
      titleSource: persisted.titleSource,
      updatedAt: persisted.updatedAt,
      leafCount: 1,
      messagePreview: '',
    }];
    const createVaultStore = () => {
      const store = createStore();
      store.listSessions.mockImplementation(async () => summaries());
      store.writeSessionMeta.mockImplementation(async (
        _ref: SessionRef,
        patch: { title?: string; titleSource?: OpenSessionState['titleSource'] },
      ) => {
        if (patch.title !== undefined) {
          persisted.title = patch.title;
        }
        if (patch.titleSource !== undefined) {
          persisted.titleSource = patch.titleSource;
        }
      });
      return store;
    };

    const firstStore = createVaultStore();
    const firstManager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => firstStore,
    });
    await firstManager.loadSummaries();
    await firstManager.rename('sdk-session', 'Durable custom title', 'custom');

    const restoredStore = createVaultStore();
    const restoredManager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => restoredStore,
    });
    await restoredManager.loadSummaries();

    expect(restoredManager.getAll()).toEqual([
      expect.objectContaining({
        title: 'Durable custom title',
        titleSource: 'custom',
        sessionFile: '.pivi/sessions/test.jsonl',
      }),
    ]);
  });

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

  it('hydrates usage from session JSONL metadata', async () => {
    const store = createStore();
    const usage: UsageInfo = {
      inputTokens: 1000,
      outputTokens: 200,
      outputTokenLimit: 4000,
      contextTokens: 1000,
      contextWindow: 200000,
      percentage: 1,
    };
    store.getUsage.mockResolvedValue(usage);
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1');

    expect(store.getUsage).toHaveBeenCalledWith({
      sessionFile: '.pivi/sessions/test.jsonl',
      leafId: undefined,
      sessionId: 'sdk-session',
    });
    expect(openSession?.usage).toBe(usage);
  });

  it('marks restored running async subagents as orphaned and keeps partial results', async () => {
    const store = createStore();
    store.getMessages.mockResolvedValue([{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Started background work',
      timestamp: 1,
      assistantMessageId: 'a1',
      contentBlocks: [{ type: 'subagent', subagentId: 'spawn-1', mode: 'async' }],
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: { run_in_background: true, label: 'Read card' },
        status: 'running',
        result: 'Partial result',
        isExpanded: false,
        subagent: {
          id: 'spawn-1',
          mode: 'async',
          description: 'Read card',
          prompt: 'Read the card',
          status: 'running',
          asyncStatus: 'running',
          result: 'Partial result',
          toolCalls: [],
          isExpanded: false,
        },
      }],
    }]);
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession()]);

    const openSession = await manager.switch('conv-1');

    expect(openSession).toBeDefined();
    if (!openSession) throw new Error('Expected an open session');
    const [message] = openSession.messages;
    expect(message).toBeDefined();
    if (!message) throw new Error('Expected a hydrated message');
    const [toolCall] = message.toolCalls ?? [];
    expect(toolCall).toBeDefined();
    if (!toolCall) throw new Error('Expected a subagent tool call');
    expect(toolCall).toEqual(expect.objectContaining({
      status: 'error',
      result: 'Partial result',
      subagent: expect.objectContaining({
        asyncStatus: 'orphaned',
        status: 'error',
        result: 'Partial result',
      }),
    }));
    expect(store.appendMessageUiPatches).toHaveBeenCalledWith(
      expect.any(Object),
      [expect.objectContaining({
        targetEntryId: 'a1',
        toolCalls: [expect.objectContaining({
          id: 'spawn-1',
          status: 'error',
          subagent: expect.objectContaining({ asyncStatus: 'orphaned' }),
        })],
      })],
    );
  });

  it('attaches an existing sessionFile without overwriting durable title meta', async () => {
    const store = createStore();
    store.listSessions.mockResolvedValue([{
      sessionFile: '.pivi/sessions/existing.jsonl',
      sessionId: 'sdk-existing',
      title: 'Custom title',
      titleSource: 'custom',
      updatedAt: 42,
      leafCount: 1,
      messagePreview: 'hello',
      messageCount: 12,
    }]);
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });

    const openSession = await manager.create({
      sessionFile: '.pivi/sessions/existing.jsonl',
      sessionId: 'sdk-existing',
    });

    expect(openSession).toEqual(expect.objectContaining({
      title: 'Custom title',
      titleSource: 'custom',
      sessionFile: '.pivi/sessions/existing.jsonl',
      sessionId: 'sdk-existing',
      hasOlderMessages: true,
      totalMessageCount: 12,
      olderMessageCount: 12,
      messagePreview: 'hello',
    }));
    expect(store.writeSessionMeta).not.toHaveBeenCalled();
    expect(store.writeUiContext).not.toHaveBeenCalled();
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

  it('persists assistant UI overlays when session messages are updated', async () => {
    const store = createStore();
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([createOpenSession({
      hasOlderMessages: true,
      totalMessageCount: 101,
      olderUserMessageCount: 50,
    })]);

    await manager.update('conv-1', {
      messages: [{
        id: 'ui-message',
        role: 'assistant',
        content: 'Done',
        timestamp: 1,
        assistantMessageId: 'a1',
        durationSeconds: 2,
        contentBlocks: [{ type: 'subagent', subagentId: 'spawn-1', mode: 'async' }],
        toolCalls: [{
          id: 'spawn-1',
          name: 'spawn_agent',
          input: { label: 'Research' },
          status: 'completed',
          isExpanded: false,
          subagent: {
            id: 'spawn-1',
            description: 'Research',
            mode: 'async',
            status: 'completed',
            asyncStatus: 'completed',
            agentId: 'subagent-1',
            result: 'Done',
            toolCalls: [],
            isExpanded: false,
          },
        }],
      }],
    });

    expect(store.appendMessageUiPatches).toHaveBeenCalledWith(
      {
        sessionFile: '.pivi/sessions/test.jsonl',
        leafId: null,
        sessionId: 'sdk-session',
      },
      [expect.objectContaining({
        targetEntryId: 'a1',
        assistantMessageId: 'a1',
        durationSeconds: 2,
        contentBlocks: [{ type: 'subagent', subagentId: 'spawn-1', mode: 'async' }],
        toolCalls: [expect.objectContaining({
          id: 'spawn-1',
          status: 'completed',
          subagent: expect.objectContaining({ agentId: 'subagent-1' }),
        })],
      })],
    );
    expect(store.getMessages).not.toHaveBeenCalled();
    expect(store.appendUserTurn).not.toHaveBeenCalled();
    expect(store.appendAgentTurn).not.toHaveBeenCalled();
    expect(manager.getSync('conv-1')).toEqual(expect.objectContaining({
      hasOlderMessages: true,
      totalMessageCount: 101,
      olderUserMessageCount: 50,
    }));
  });

  it('propagates a stale partial save without committing in-memory updates', async () => {
    const store = createStore();
    const stale = new SessionIndexStaleError(
      'Session changed before save',
      '.pivi/sessions/test.jsonl',
    );
    store.open.mockRejectedValue(stale);
    const original = createOpenSession({
      messages: [hydratedMessage],
      totalMessageCount: 101,
      olderUserMessageCount: 50,
    });
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([original]);

    await expect(manager.update('conv-1', {
      messages: [{ ...hydratedMessage, displayContent: 'changed' }],
      totalMessageCount: 102,
    })).rejects.toBe(stale);

    expect(manager.getSync('conv-1')).toBe(original);
    expect(original.messages).toEqual([hydratedMessage]);
    expect(original.totalMessageCount).toBe(101);
    expect(store.appendMessageUiPatches).not.toHaveBeenCalled();
  });

  it('propagates a stale UI overlay append without committing the partial page', async () => {
    const store = createStore();
    const stale = new SessionIndexStaleError(
      'Session changed before UI overlay append',
      '.pivi/sessions/test.jsonl',
    );
    store.appendMessageUiPatches.mockRejectedValue(stale);
    const original = createOpenSession({
      messages: [hydratedMessage],
      totalMessageCount: 101,
      olderMessageCount: 100,
      olderUserMessageCount: 50,
    });
    const manager = new OpenSessionManager({
      getVaultPath: () => '/vault',
      getStore: () => store,
    });
    manager.replaceAll([original]);

    await expect(manager.update('conv-1', {
      messages: [{ ...hydratedMessage, displayContent: 'changed', userMessageId: 'u1' }],
    })).rejects.toBe(stale);

    expect(original.messages).toEqual([hydratedMessage]);
    expect(original.totalMessageCount).toBe(101);
    expect(original.olderMessageCount).toBe(100);
  });
});
