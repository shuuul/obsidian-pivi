import type { AgentEngine, AgentEngineSessionRef } from '@pivi/pivi-agent-core/engine';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { ToolProvider } from '@pivi/pivi-agent-core/plugins';
import type { WorkspaceFileStore } from '@pivi/pivi-agent-core/ports';
import type { AgentCoreHost, AgentCoreMcpServices } from '@pivi/pivi-agent-core/runtime/agentCoreHost';
import { AgentCoreRuntime } from '@pivi/pivi-agent-core/runtime/agentCoreRuntime';
import type { ChatTurnMetadata, ChatTurnRequest, PreparedChatTurn } from '@pivi/pivi-agent-core/runtime/types';
import type { SessionRef, SessionStore } from '@pivi/pivi-agent-core/session';
import type { ToolSpec } from '@pivi/pivi-agent-core/tools';
import type { WorkspaceContext } from '@pivi/pivi-agent-core/workspace';

type EngineSpy = AgentEngine & {
  syncCalls: Array<{ ref: AgentEngineSessionRef | null; paths?: string[] }>;
  cancelCount: number;
  resetCount: number;
  queryCalls: Array<{ turn: PreparedChatTurn; history?: ChatMessage[] }>;
};

function sessionRef(sessionFile: string, leafId: string | null = null): SessionRef {
  return { sessionFile, leafId, sessionId: `sid-${sessionFile}` };
}

function createEngineSpy(label: string): EngineSpy {
  const state = {
    syncCalls: [] as EngineSpy['syncCalls'],
    cancelCount: 0,
    resetCount: 0,
    queryCalls: [] as EngineSpy['queryCalls'],
  };
  const emptyMetadata: ChatTurnMetadata = {};

  return {
    get syncCalls() {
      return state.syncCalls;
    },
    get cancelCount() {
      return state.cancelCount;
    },
    get resetCount() {
      return state.resetCount;
    },
    get queryCalls() {
      return state.queryCalls;
    },
    syncSession: (ref, externalContextPaths) => {
      state.syncCalls.push({ ref, paths: externalContextPaths });
    },
    query: async function* (turn, openSessionHistory) {
      state.queryCalls.push({ turn, history: openSessionHistory });
      yield { type: 'text', content: label } satisfies StreamChunk;
    },
    cancel: () => {
      state.cancelCount += 1;
    },
    resetSession: () => {
      state.resetCount += 1;
    },
    getSessionId: () => `${label}-sdk`,
    rewind: async () => ({ canRewind: true }),
    consumeTurnMetadata: () => emptyMetadata,
    cleanup: () => {},
  };
}

type SessionStoreSpy = SessionStore & {
  createPaths: string[];
  lastGetMessagesRef: SessionRef | null;
};

function createSessionStoreSpy(refForCreate: SessionRef): SessionStoreSpy {
  const state = {
    createPaths: [] as string[],
    lastGetMessagesRef: null as SessionRef | null,
    messages: [{ role: 'user', content: 'stored' }] as ChatMessage[],
  };

  return {
    get createPaths() {
      return state.createPaths;
    },
    get lastGetMessagesRef() {
      return state.lastGetMessagesRef;
    },
    listSessions: async () => [],
    create: async (vaultPath) => {
      state.createPaths.push(vaultPath);
      return refForCreate;
    },
    open: async () => refForCreate,
    getMessages: async (ref) => {
      state.lastGetMessagesRef = ref;
      return state.messages;
    },
    openRecent: async () => ({
      messages: state.messages,
      hasOlder: false,
      totalMessageCount: state.messages.length,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
    }),
    readOlder: async () => ({
      messages: [],
      hasOlder: false,
      totalMessageCount: state.messages.length,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
    }),
    appendUserTurn: async () => refForCreate,
    appendAgentTurn: async () => refForCreate,
    fork: async () => refForCreate,
    deleteSession: async () => {},
    readUiContext: async () => ({}),
    writeUiContext: async () => {},
    writeSessionMeta: async () => {},
    sessionRefFromOpenSession: () => refForCreate,
  };
}

function createToolProvider(id: string, tools: ToolSpec[]): ToolProvider {
  return {
    id,
    listTools: async () => tools,
  };
}

function createEmptyFileStore(): WorkspaceFileStore {
  return {
    exists: async () => false,
    read: async () => '',
    write: async () => {},
    append: async () => {},
    delete: async () => {},
    deleteFolder: async () => {},
    listFiles: async () => [],
    listFolders: async () => [],
    listFilesRecursive: async () => [],
    ensureFolder: async () => {},
    rename: async () => {},
    stat: async () => null,
  };
}

function createHost(options: {
  workspace: WorkspaceContext;
  sessions: SessionStoreSpy;
  engine: EngineSpy;
  tools?: ToolProvider[];
  mcp?: AgentCoreMcpServices | null;
}): AgentCoreHost {
  return {
    workspace: options.workspace,
    files: createEmptyFileStore(),
    sessions: options.sessions,
    engine: options.engine,
    tools: options.tools ?? [],
    contextProviders: [],
    mcp: options.mcp ?? null,
  };
}

function minimalTurn(): PreparedChatTurn {
  return {
    request: { text: 'hi' },
    displayContent: 'hi',
    persistedContent: 'hi',
    prompt: 'hi',
    isCompact: false,
    mcpMentions: new Set(),
  };
}

describe('AgentCoreRuntime', () => {
  describe('createSession', () => {
    it('uses workspace.rootUri for session store create and binds engine to new ref', async () => {
      const created = sessionRef('ws/sessions/a.jsonl');
      const sessions = createSessionStoreSpy(created);
      const engine = createEngineSpy('e1');
      const workspace: WorkspaceContext = {
        id: 'vault-id',
        name: 'Vault',
        kind: 'obsidian-vault',
        rootUri: 'file:///vaults/alpha',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      const ref = await runtime.createSession();

      expect(sessions.createPaths).toEqual(['file:///vaults/alpha']);
      expect(ref).toBe(created);
      expect(runtime.getBoundSession()).toBe(created);
      expect(engine.syncCalls).toEqual([
        {
          ref: { sessionFile: created.sessionFile, leafId: null },
          paths: undefined,
        },
      ]);
      expect(engine.cancelCount).toBe(0);
      expect(engine.resetCount).toBe(0);
    });

    it('falls back to workspace.id when rootUri is absent', async () => {
      const created = sessionRef('proj/sessions/b.jsonl');
      const sessions = createSessionStoreSpy(created);
      const engine = createEngineSpy('e2');
      const workspace: WorkspaceContext = {
        id: 'project-42',
        name: 'CLI Project',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      await runtime.createSession();

      expect(sessions.createPaths).toEqual(['project-42']);
    });
  });

  describe('bindSession', () => {
    it('is idempotent when binding the same session ref', () => {
      const ref = sessionRef('same.jsonl', 'leaf-1');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('e3');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      runtime.bindSession(ref);
      runtime.bindSession(ref);

      expect(engine.syncCalls).toHaveLength(1);
      expect(engine.cancelCount).toBe(0);
      expect(engine.resetCount).toBe(0);
    });

    it('cancels, resets, and syncs when switching to a different session', () => {
      const first = sessionRef('one.jsonl');
      const second = sessionRef('two.jsonl', 'leaf-b');
      const sessions = createSessionStoreSpy(first);
      const engine = createEngineSpy('e4');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      runtime.bindSession(first, ['ctx/a.md']);
      runtime.bindSession(second, ['ctx/b.md']);

      expect(engine.cancelCount).toBe(1);
      expect(engine.resetCount).toBe(1);
      expect(engine.syncCalls).toEqual([
        { ref: { sessionFile: 'one.jsonl', leafId: null }, paths: ['ctx/a.md'] },
        { ref: { sessionFile: 'two.jsonl', leafId: 'leaf-b' }, paths: ['ctx/b.md'] },
      ]);
      expect(runtime.getBoundSession()).toBe(second);
    });

    it('clears binding and engine session when ref is null', () => {
      const ref = sessionRef('clear.jsonl');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('e5');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      runtime.bindSession(ref);
      runtime.bindSession(null, ['orphan']);

      expect(engine.cancelCount).toBe(1);
      expect(engine.resetCount).toBe(1);
      expect(engine.syncCalls.at(-1)).toEqual({ ref: null, paths: ['orphan'] });
      expect(runtime.getBoundSession()).toBeNull();
    });
  });

  describe('loadHistory', () => {
    it('returns messages from the session store for the bound ref', async () => {
      const ref = sessionRef('hist.jsonl');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('e6');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );
      runtime.bindSession(ref);

      const messages = await runtime.loadHistory();

      expect(messages).toEqual([{ role: 'user', content: 'stored' }]);
      expect(sessions.lastGetMessagesRef).toBe(ref);
    });

    it('throws when no session is bound', async () => {
      const sessions = createSessionStoreSpy(sessionRef('x.jsonl'));
      const engine = createEngineSpy('e7');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      await expect(runtime.loadHistory()).rejects.toThrow(
        'Cannot load AgentCoreRuntime history without a bound session.',
      );
    });
  });

  describe('listToolSpecs', () => {
    it('aggregates tool lists from every tool provider', async () => {
      const ref = sessionRef('tools.jsonl');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('e8');
      const toolA: ToolSpec = {
        name: 'alpha',
        description: 'a',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({}),
      };
      const toolB: ToolSpec = {
        name: 'beta',
        description: 'b',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({}),
      };
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({
          workspace,
          sessions,
          engine,
          tools: [
            createToolProvider('p1', [toolA]),
            createToolProvider('p2', [toolB]),
          ],
        }),
      );

      const specs = await runtime.listToolSpecs({ channel: 'test' });

      expect(specs).toEqual([toolA, toolB]);
    });
  });

  describe('query', () => {
    it('delegates to the engine and yields stream chunks', async () => {
      const ref = sessionRef('query.jsonl');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('stream-label');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );
      const turn = minimalTurn();
      const history = [{ role: 'assistant', content: 'prior' }] as ChatMessage[];

      const chunks: StreamChunk[] = [];
      for await (const chunk of runtime.query(turn, history)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ type: 'text', content: 'stream-label' }]);
      expect(engine.queryCalls).toEqual([{ turn, history }]);
    });
  });

  describe('prepareTurn', () => {
    const workspace: WorkspaceContext = {
      id: 'w',
      name: 'W',
      kind: 'cli-project',
    };

    function runtimeWithMcp(mcp: AgentCoreMcpServices | null | undefined): AgentCoreRuntime {
      const sessions = createSessionStoreSpy(sessionRef('prep.jsonl'));
      const engine = createEngineSpy('prep');
      return new AgentCoreRuntime(createHost({ workspace, sessions, engine, mcp }));
    }

    it('transforms MCP mentions for the API prompt and merges enabled servers into mcpMentions', () => {
      const extractMentions = jest.fn((_content: string) => new Set(['mentioned-server']));
      const transformMentions = jest.fn((text: string) =>
        text.replace('@mentioned-server', '@mentioned-server MCP'),
      );
      const runtime = runtimeWithMcp({ extractMentions, transformMentions });

      const request: ChatTurnRequest = {
        text: 'Use @mentioned-server please',
        enabledMcpServers: new Set(['enabled-only']),
      };

      const turn = runtime.prepareTurn(request);

      expect(turn.persistedContent).toContain('@mentioned-server');
      expect(turn.prompt).toContain('@mentioned-server MCP');
      expect(turn.mcpMentions).toEqual(new Set(['mentioned-server', 'enabled-only']));
      expect(extractMentions).toHaveBeenCalledWith(expect.stringContaining('Use @mentioned-server'));
      expect(transformMentions).toHaveBeenCalled();
      expect(turn.isCompact).toBe(false);
      expect(turn.request).toBe(request);
    });

    it('propagates enabled MCP servers when host MCP mention ops are unavailable', () => {
      const runtime = runtimeWithMcp(null);

      const request: ChatTurnRequest = {
        text: 'plain user text',
        enabledMcpServers: new Set(['alpha', 'beta']),
      };

      const turn = runtime.prepareTurn(request);

      expect(turn.persistedContent).toBe('plain user text');
      expect(turn.prompt).toBe('plain user text');
      expect(turn.mcpMentions).toEqual(new Set(['alpha', 'beta']));
    });

    it('propagates enabled servers when MCP service lacks extract or transform hooks', () => {
      const runtime = runtimeWithMcp({
        extractMentions: jest.fn(() => new Set(['orphan-mention'])),
      });

      const request: ChatTurnRequest = {
        text: '@orphan-mention hello',
        enabledMcpServers: new Set(['gamma']),
      };

      const turn = runtime.prepareTurn(request);

      expect(turn.persistedContent).toBe('@orphan-mention hello');
      expect(turn.prompt).toBe('@orphan-mention hello');
      expect(turn.mcpMentions).toEqual(new Set(['gamma']));
    });

    it('marks compact turns and still merges enabled MCP servers without calling transform', () => {
      const transformMentions = jest.fn((text: string) => text);
      const runtime = runtimeWithMcp({
        extractMentions: jest.fn(() => new Set()),
        transformMentions,
      });

      const request: ChatTurnRequest = {
        text: '/compact keep recent',
        currentNotePath: 'notes/foo.md',
        enabledMcpServers: new Set(['compact-enabled']),
      };

      const turn = runtime.prepareTurn(request);

      expect(turn.isCompact).toBe(true);
      expect(turn.persistedContent).toBe('/compact keep recent');
      expect(turn.prompt).toBe('/compact keep recent');
      expect(turn.mcpMentions).toEqual(new Set(['compact-enabled']));
      expect(transformMentions).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('cancels, resets, and clears binding when a session is bound', () => {
      const ref = sessionRef('close.jsonl');
      const sessions = createSessionStoreSpy(ref);
      const engine = createEngineSpy('e9');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );
      runtime.bindSession(ref);
      const cancelBefore = engine.cancelCount;
      const resetBefore = engine.resetCount;

      runtime.close();

      expect(engine.cancelCount).toBe(cancelBefore + 1);
      expect(engine.resetCount).toBe(resetBefore + 1);
      expect(runtime.getBoundSession()).toBeNull();
    });

    it('is safe when already closed or never bound', () => {
      const sessions = createSessionStoreSpy(sessionRef('none.jsonl'));
      const engine = createEngineSpy('e10');
      const workspace: WorkspaceContext = {
        id: 'w',
        name: 'W',
        kind: 'cli-project',
        piviDir: '.pivi',
      };
      const runtime = new AgentCoreRuntime(
        createHost({ workspace, sessions, engine }),
      );

      runtime.close();
      runtime.close();

      expect(engine.cancelCount).toBe(0);
      expect(engine.resetCount).toBe(0);
    });
  });
});
