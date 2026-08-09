import type { MentionVaultEntry } from '@pivi/pivi-agent-core/context/mentions';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { PreparedChatTurn } from '@pivi/pivi-agent-core/runtime/types';
import type { StoreSessionInfo } from '@pivi/pivi-agent-core/session/types';

import {
  collectMobileMentionFilePaths,
  MobileChatController,
  type MobileChatViewState,
} from '@/app/composition/mobile/MobileChatController';
import type { MobileReadiness, MobileWorkspace } from '@/app/composition/mobile/MobileWorkspace';

function readyState(overrides: Partial<MobileReadiness> = {}): MobileReadiness {
  return {
    secretStorage: true,
    provider: true,
    model: true,
    credential: true,
    tools: true,
    ready: true,
    missing: [],
    ...overrides,
  };
}

function deferredChunks(chunks: StreamChunk[]): {
  iterator: AsyncGenerator<StreamChunk>;
  release: () => void;
  cancel: jest.Mock;
} {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const cancel = jest.fn();
  async function* iterator(): AsyncGenerator<StreamChunk> {
    await gate;
    for (const chunk of chunks) yield chunk;
  }
  return { iterator: iterator(), release, cancel };
}

function createFakeRuntime(options: {
  chunks?: StreamChunk[];
  streaming?: ReturnType<typeof deferredChunks>;
  sessionFileAfter?: string;
} = {}): PiChatService & {
  prepareTurn: jest.Mock;
  query: jest.Mock;
  cancel: jest.Mock;
  cleanup: jest.Mock;
  syncSession: jest.Mock;
} {
  const streaming = options.streaming;
  const chunks = options.chunks ?? [
    { type: 'text', content: 'Hello' } satisfies StreamChunk,
    { type: 'done' } satisfies StreamChunk,
  ];
  return {
    prepareTurn: jest.fn((request): PreparedChatTurn => ({
      request,
      displayContent: request.text,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: false,
      mcpMentions: new Set(),
    })),
    query: jest.fn(async function* query(): AsyncGenerator<StreamChunk> {
      if (streaming) {
        for await (const chunk of streaming.iterator) yield chunk;
        return;
      }
      for (const chunk of chunks) yield chunk;
    }),
    cancel: streaming?.cancel ?? jest.fn(),
    cleanup: jest.fn(),
    syncSession: jest.fn(),
    onReadyStateChange: jest.fn(() => () => undefined),
    reloadMcpServers: jest.fn(async () => undefined),
    ensureReady: jest.fn(async () => true),
    resetSession: jest.fn(),
    getSessionId: jest.fn(() => 'session-1'),
    isReady: jest.fn(() => true),
    rewind: jest.fn(async () => ({ canRewind: true })),
    consumeTurnMetadata: jest.fn(() => ({ userParentEntryId: 'parent-1' })),
    getSessionStateUpdates: jest.fn(() => (
      options.sessionFileAfter ? { sessionFile: options.sessionFileAfter, title: 'Titled' } : {}
    )),
  };
}

function createWorkspace(options: {
  readiness?: MobileReadiness;
  sessions?: StoreSessionInfo[];
  messages?: ChatMessage[];
  runtimeFactory?: () => PiChatService;
} = {}): MobileWorkspace & {
  createChatRuntime: jest.Mock;
  readiness: jest.Mock;
  sessions: {
    listSessions: jest.Mock;
    open: jest.Mock;
    openRecent: jest.Mock;
    writeSessionMeta: jest.Mock;
    fork: jest.Mock;
    deleteSession: jest.Mock;
  };
} {
  const sessions = options.sessions ?? [];
  const messages = options.messages ?? [];
  let runtimeIndex = 0;
  let settingsListener: (() => void) | undefined;
  const createChatRuntime = jest.fn(() => {
    if (options.runtimeFactory) return options.runtimeFactory();
    runtimeIndex += 1;
    return createFakeRuntime({ sessionFileAfter: `.pivi/sessions/s${runtimeIndex}.jsonl` });
  });
  return {
    app: {
      workspace: {
        getActiveFile: jest.fn(() => ({ path: 'Notes/active.md' })),
      },
    },
    readiness: jest.fn(() => options.readiness ?? readyState()),
    onSurfacesChanged: jest.fn((listener: () => void) => {
      settingsListener = listener;
      return () => {
        settingsListener = undefined;
      };
    }),
    notifySurfacesChanged: jest.fn(() => settingsListener?.()),
    sanitizeDiagnostic: jest.fn((value: string) => value),
    archivedSessions: {
      load: jest.fn(() => new Set<string>()),
      save: jest.fn(),
    },
    createChatRuntime,
    sessions: {
      listSessions: jest.fn(async () => sessions),
      open: jest.fn(async (sessionFile: string) => ({
        sessionFile,
        sessionId: 'sid',
      })),
      openRecent: jest.fn(async () => ({
        messages,
        hasOlder: false,
        totalMessageCount: messages.length,
        olderMessageCount: 0,
        olderUserMessageCount: 0,
      })),
      writeSessionMeta: jest.fn(async () => undefined),
      fork: jest.fn(async () => ({ sessionFile: '.pivi/sessions/fork.jsonl', sessionId: 'fork' })),
      deleteSession: jest.fn(async () => undefined),
    },
  } as unknown as MobileWorkspace & {
    createChatRuntime: jest.Mock;
    readiness: jest.Mock;
    sessions: {
      listSessions: jest.Mock;
      open: jest.Mock;
      openRecent: jest.Mock;
      writeSessionMeta: jest.Mock;
      fork: jest.Mock;
      deleteSession: jest.Mock;
    };
  };
}

describe('MobileChatController', () => {
  it('expands Mobile file and folder mentions into deduplicated Vault-relative context paths', () => {
    const files = [
      { path: 'Notes/one.md', basename: 'one' },
      { path: 'Notes/nested/two.md', basename: 'two' },
      { path: 'Other/three.md', basename: 'three' },
    ];
    const folders = [{ path: 'Notes', name: 'Notes' }];
    const entries = new Map<string, MentionVaultEntry>([
      ...files.map(file => [file.path, { kind: 'file' as const, ...file }] as const),
      ...folders.map(folder => [folder.path, { kind: 'folder' as const, ...folder }] as const),
    ]);
    const vault = {
      getFiles: () => files,
      getFolders: () => folders,
      getByPath: (path: string) => entries.get(path.replace(/\/$/, '')) ?? null,
      resolveWikilink: (path: string) => entries.get(path) ?? null,
    };

    expect(collectMobileMentionFilePaths(
      'Read @Notes/ and compare @[[Notes/one.md]] with @missing.md',
      vault,
    )).toEqual(['Notes/nested/two.md', 'Notes/one.md']);
    expect(collectMobileMentionFilePaths('No context', vault)).toBeUndefined();
  });

  it('streams send chunks incrementally and gates send on readiness', async () => {
    const states: MobileChatViewState[] = [];
    const streaming = deferredChunks([
      { type: 'text', content: 'Hel' },
      { type: 'text', content: 'lo' },
      { type: 'thinking', content: 'plan' },
      { type: 'tool_use', id: 't1', name: 'obsidian_read', input: {} },
      { type: 'tool_result', id: 't1', content: 'note body' },
      { type: 'done' },
    ]);
    const runtime = createFakeRuntime({
      streaming,
      sessionFileAfter: '.pivi/sessions/s1.jsonl',
    });
    const workspace = createWorkspace({
      readiness: readyState({ ready: false, missing: ['Choose a model in Pivi settings.'] }),
      runtimeFactory: () => runtime,
    });
    const controller = new MobileChatController(workspace, {
      render: state => {
        states.push(structuredClone(state));
      },
    });

    await controller.open();
    controller.setComposer('hi');
    expect(states.at(-1)?.canSend).toBe(false);

    workspace.readiness.mockReturnValue(readyState());
    controller.refreshReadiness();
    controller.setComposer('hi');
    expect(states.at(-1)?.canSend).toBe(true);

    const sendPromise = controller.send();
    expect(states.some(state => state.turnActive && !state.canSend)).toBe(true);
    expect(runtime.prepareTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hi',
      currentNotePath: 'Notes/active.md',
    }));

    streaming.release();
    await sendPromise;

    const final = states.at(-1)!;
    expect(final.turnActive).toBe(false);
    expect(final.rows.map(row => row.kind)).toEqual([
      'user', 'assistant', 'thinking', 'tool',
    ]);
    expect(final.rows.find(row => row.kind === 'assistant')?.text).toBe('Hello');
    expect(final.rows.some(row => row.kind === 'tool' && row.toolName === 'obsidian_read')).toBe(true);
    expect(final.sessionFile).toBe('.pivi/sessions/s1.jsonl');
  });

  it('stop cancels the active runtime turn', async () => {
    const streaming = deferredChunks([
      { type: 'text', content: 'partial' },
      { type: 'done' },
    ]);
    const runtime = createFakeRuntime({ streaming });
    const workspace = createWorkspace({ runtimeFactory: () => runtime });
    const controller = new MobileChatController(workspace, { render: () => undefined });
    await controller.open();
    controller.setComposer('stop me');
    const sendPromise = controller.send();
    controller.stop();
    expect(runtime.cancel).toHaveBeenCalled();
    streaming.release();
    await sendPromise;
  });

  it('retry resubmits the last user request after a terminal failure', async () => {
    const runtime = createFakeRuntime({
      chunks: [
        { type: 'error', content: 'provider down' },
        { type: 'done' },
      ],
    });
    const workspace = createWorkspace({ runtimeFactory: () => runtime });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, {
      render: state => {
        states.push(structuredClone(state));
      },
    });
    await controller.open();
    controller.setComposer('try once');
    await controller.send();
    expect(states.at(-1)?.canRetry).toBe(true);
    expect(states.at(-1)?.rows.some(row => row.kind === 'error')).toBe(true);

    runtime.query.mockImplementation(async function* query(): AsyncGenerator<StreamChunk> {
      yield { type: 'text', content: 'recovered' };
      yield { type: 'done' };
    });
    await controller.retry();
    expect(runtime.prepareTurn).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'try once' }));
    expect(runtime.rewind).toHaveBeenCalledWith('parent-1');
    expect(states.at(-1)?.rows.filter(row => row.kind === 'user')).toHaveLength(1);
    expect(states.at(-1)?.canRetry).toBe(false);
  });

  it('sanitizes reflected provider credentials from rows and retry diagnostics', async () => {
    const sentinel = 'secret-sentinel';
    const runtime = createFakeRuntime({
      chunks: [
        { type: 'text', content: `echo ${sentinel}` },
        { type: 'retry_start', attempt: 1, maxAttempts: 2, delayMs: 1, errorMessage: sentinel },
        { type: 'error', content: `failed ${sentinel}` },
        { type: 'done' },
      ],
    });
    const workspace = createWorkspace({ runtimeFactory: () => runtime });
    workspace.sanitizeDiagnostic = jest.fn((value: string) => value.replaceAll(sentinel, '[redacted]'));
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, {
      render: state => states.push(structuredClone(state)),
    });
    await controller.open();
    controller.setComposer('send');
    await controller.send();
    const final = states.at(-1)!;
    expect(final.rows.map(row => row.text).join(' ')).not.toContain(sentinel);
    expect(final.status).not.toContain(sentinel);
  });

  it('session reopen hydrates durable messages through a fresh runtime', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'prior',
        timestamp: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'answer',
        timestamp: 2,
        contentBlocks: [
          { type: 'thinking', content: 'think' },
          { type: 'text', content: 'answer' },
        ],
      },
    ];
    const sessions: StoreSessionInfo[] = [{
      sessionFile: '.pivi/sessions/old.jsonl',
      sessionId: 'old',
      title: 'Prior chat',
      updatedAt: 2,
      leafCount: 1,
      messagePreview: 'prior',
      messageCount: 2,
    }];
    const runtime = createFakeRuntime();
    const workspace = createWorkspace({
      sessions,
      messages,
      runtimeFactory: () => runtime,
    });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, {
      render: state => {
        states.push(structuredClone(state));
      },
    });
    await controller.open();
    expect(workspace.sessions.open).toHaveBeenCalledWith('.pivi/sessions/old.jsonl');
    expect(runtime.syncSession).toHaveBeenCalledWith({ sessionFile: '.pivi/sessions/old.jsonl' });
    const final = states.at(-1)!;
    expect(final.sessionTitle).toBe('Prior chat');
    expect(final.rows.map(row => ({ kind: row.kind, text: row.text }))).toEqual([
      { kind: 'user', text: 'prior' },
      { kind: 'thinking', text: 'think' },
      { kind: 'assistant', text: 'answer' },
    ]);
  });

  it('sanitizes every hydrated assistant diagnostic row', async () => {
    const sentinel = 'reopened-provider-b-sentinel';
    const workspace = createWorkspace({
      sessions: [{
        sessionFile: '.pivi/sessions/b.jsonl', sessionId: 'b', title: 'B', updatedAt: 1,
        leafCount: 1, messagePreview: 'b', messageCount: 1,
      }],
      messages: [{
        id: 'a', role: 'assistant', content: sentinel, timestamp: 1,
        toolCalls: [{ id: 'tool', name: 'read', input: {}, status: 'completed', result: sentinel }],
      }],
    });
    workspace.sanitizeDiagnostic = jest.fn((value: string) => value.replaceAll(sentinel, '[redacted]'));
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, { render: state => states.push(structuredClone(state)) });
    await controller.open();
    expect(states.at(-1)?.rows.map(row => row.text)).toEqual(['[redacted]', '[redacted]']);
  });

  it('onClose cancels cleanup and drops late stream appends', async () => {
    const streaming = deferredChunks([
      { type: 'text', content: 'late' },
      { type: 'done' },
    ]);
    const runtime = createFakeRuntime({ streaming });
    const workspace = createWorkspace({ runtimeFactory: () => runtime });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, {
      render: state => {
        states.push(structuredClone(state));
      },
    });
    await controller.open();
    controller.setComposer('going away');
    const sendPromise = controller.send();
    controller.close();
    expect(runtime.cancel).toHaveBeenCalled();
    expect(runtime.cleanup).toHaveBeenCalled();
    streaming.release();
    await sendPromise;
    expect(states.some(state => state.rows.some(row => row.text.includes('late')))).toBe(false);
  });

  it('discards an open runtime when device-local settings change', async () => {
    const first = createFakeRuntime();
    const second = createFakeRuntime();
    const runtimes = [first, second];
    const workspace = createWorkspace({ runtimeFactory: () => runtimes.shift()! });
    const controller = new MobileChatController(workspace, { render: () => undefined });
    await controller.open();
    controller.setComposer('first');
    await controller.send();

    workspace.notifySurfacesChanged();
    expect(first.cancel).toHaveBeenCalled();
    expect(first.cleanup).toHaveBeenCalled();

    controller.setComposer('second');
    await controller.send();
    expect(second.prepareTurn).toHaveBeenCalled();
  });

  it('synchronously settles and invalidates a deferred stream when settings change', async () => {
    const streaming = deferredChunks([{ type: 'text', content: 'stale' }, { type: 'done' }]);
    const runtime = createFakeRuntime({ streaming });
    const workspace = createWorkspace({ runtimeFactory: () => runtime });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, {
      render: state => states.push(structuredClone(state)),
    });
    await controller.open();
    controller.setComposer('pending');
    const send = controller.send();

    workspace.notifySurfacesChanged();
    expect(states.at(-1)).toMatchObject({ turnActive: false, canStop: false, status: '' });
    expect(runtime.cancel).toHaveBeenCalled();
    streaming.release();
    await send;
    expect(states.at(-1)?.rows.some(row => row.text === 'stale')).toBe(false);
  });

  it('does not retry through a replacement runtime after deferred rewind', async () => {
    let release!: () => void;
    const first = createFakeRuntime({ chunks: [{ type: 'error', content: 'failed' }, { type: 'done' }] });
    first.rewind = jest.fn(() => new Promise(resolve => { release = () => resolve({ canRewind: true }); }));
    const second = createFakeRuntime();
    const runtimes = [first, second];
    const workspace = createWorkspace({ runtimeFactory: () => runtimes.shift()! });
    const controller = new MobileChatController(workspace, { render: () => undefined });
    await controller.open();
    controller.setComposer('once');
    await controller.send();

    const retry = controller.retry();
    await Promise.resolve();
    workspace.notifySurfacesChanged();
    release();
    await retry;
    expect(first.prepareTurn).toHaveBeenCalledTimes(1);
    expect(second.prepareTurn).not.toHaveBeenCalled();
  });

  it('renames, forks, archives, shows, restores, and deletes through the workspace', async () => {
    const sessions: StoreSessionInfo[] = [{
      sessionFile: '.pivi/sessions/a.jsonl', sessionId: 'a', title: 'A', updatedAt: 2,
      leafCount: 1, messagePreview: 'a', messageCount: 1,
    }];
    const workspace = createWorkspace({ sessions, messages: [{
      id: 'entry-a', userMessageId: 'entry-a', role: 'user', content: 'a', timestamp: 1,
    }] });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, { render: state => states.push(structuredClone(state)) });
    await controller.open();

    await controller.rename(' Renamed ');
    expect(workspace.sessions.writeSessionMeta).toHaveBeenCalledWith(
      expect.objectContaining({ sessionFile: '.pivi/sessions/a.jsonl' }),
      { title: 'Renamed', titleSource: 'custom' },
    );
    await controller.fork();
    expect(workspace.sessions.fork).toHaveBeenCalledWith(expect.anything(), 'entry-a');

    // Return to the source to exercise local archive visibility and destructive deletion.
    await controller.pickSession('.pivi/sessions/a.jsonl');
    controller.archive();
    controller.setShowArchived(true);
    expect(states.at(-1)?.showArchived).toBe(true);
    expect(workspace.archivedSessions.save).toHaveBeenCalled();
    controller.restore('.pivi/sessions/a.jsonl');
    await controller.pickSession('.pivi/sessions/a.jsonl');
    await controller.deleteCurrent();
    expect(workspace.sessions.deleteSession).toHaveBeenCalledWith('.pivi/sessions/a.jsonl');
  });

  it('lets a newer B navigation win over a deferred A rename', async () => {
    const sessions: StoreSessionInfo[] = ['a', 'b'].map((id, index) => ({
      sessionFile: `.pivi/sessions/${id}.jsonl`, sessionId: id, title: id.toUpperCase(),
      updatedAt: 2 - index, leafCount: 1, messagePreview: id, messageCount: 1,
    }));
    const workspace = createWorkspace({ sessions });
    let release!: () => void;
    workspace.sessions.writeSessionMeta.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, { render: state => states.push(structuredClone(state)) });
    await controller.open();

    const rename = controller.rename('late A');
    await Promise.resolve();
    await controller.pickSession('.pivi/sessions/b.jsonl');
    release();
    await rename;

    expect(states.at(-1)?.sessionFile).toBe('.pivi/sessions/b.jsonl');
    expect(states.at(-1)?.sessionTitle).toBe('B');
  });

  it('lets restore supersede a deferred archive fallback navigation', async () => {
    const sessions: StoreSessionInfo[] = ['a', 'b'].map((id, index) => ({
      sessionFile: `.pivi/sessions/${id}.jsonl`, sessionId: id, title: id.toUpperCase(),
      updatedAt: 2 - index, leafCount: 1, messagePreview: id, messageCount: 1,
    }));
    const workspace = createWorkspace({ sessions });
    let release!: () => void;
    workspace.sessions.open.mockImplementation(async (file: string) => {
      if (file.endsWith('/b.jsonl')) await new Promise<void>(resolve => { release = resolve; });
      return { sessionFile: file, sessionId: file };
    });
    const states: MobileChatViewState[] = [];
    const controller = new MobileChatController(workspace, { render: state => states.push(structuredClone(state)) });
    await controller.open();
    controller.archive();
    await Promise.resolve();
    controller.restore('.pivi/sessions/a.jsonl');
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.sessionFile).toBe('.pivi/sessions/a.jsonl');
  });
});
