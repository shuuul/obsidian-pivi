import type { AgentEngine, AgentEngineSessionRef } from '@pivi/pivi-agent-core/engine';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import { AgentCoreRuntime } from '@pivi/pivi-agent-core/runtime/agentCoreRuntime';
import type { ChatTurnMetadata, PreparedChatTurn } from '@pivi/pivi-agent-core/runtime/types';
import type { SessionRef, SessionStore } from '@pivi/pivi-agent-core/session';
import {
  createCliProjectLikeHost,
  createObsidianLikeHost,
} from './agentCoreFakeHosts';

type EngineSpy = AgentEngine & {
  syncCalls: Array<{ ref: AgentEngineSessionRef | null; paths?: string[] }>;
  queryCalls: Array<{ turn: PreparedChatTurn; history?: ChatMessage[] }>;
};

type SessionStoreSpy = SessionStore & {
  createPaths: string[];
  lastGetMessagesRef: SessionRef | null;
};

function sessionRef(sessionFile: string, leafId: string | null = null): SessionRef {
  return { sessionFile, leafId, sessionId: `sid-${sessionFile}` };
}

function createEngineSpy(label: string): EngineSpy {
  const state = {
    syncCalls: [] as EngineSpy['syncCalls'],
    queryCalls: [] as EngineSpy['queryCalls'],
  };
  const emptyMetadata: ChatTurnMetadata = {};

  return {
    get syncCalls() {
      return state.syncCalls;
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
    cancel: () => {},
    resetSession: () => {},
    getSessionId: () => `${label}-sdk`,
    rewind: async () => ({ canRewind: true }),
    consumeTurnMetadata: () => emptyMetadata,
    cleanup: () => {},
  };
}

function createSessionStoreSpy(label: string, refForCreate: SessionRef): SessionStoreSpy {
  const state = {
    createPaths: [] as string[],
    lastGetMessagesRef: null as SessionRef | null,
    messages: [{ role: 'user', content: `${label}-history` }] as ChatMessage[],
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

function minimalTurn(text: string): PreparedChatTurn {
  return {
    request: { text },
    persistedContent: text,
    prompt: text,
    isCompact: false,
    mcpMentions: new Set(),
  };
}

describe('AgentCoreRuntime multi-client hosts', () => {
  it('runs obsidian-vault and cli-project hosts through the same core runtime without core changes', async () => {
    const vaultRef = sessionRef('vault/sessions/live.jsonl');
    const cliRef = sessionRef('cli/sessions/live.jsonl', 'leaf-cli');
    const vaultSessions = createSessionStoreSpy('vault', vaultRef);
    const cliSessions = createSessionStoreSpy('cli', cliRef);
    const vaultEngine = createEngineSpy('vault-stream');
    const cliEngine = createEngineSpy('cli-stream');

    const vaultHost = createObsidianLikeHost({
      sessions: vaultSessions,
      engine: vaultEngine,
    });
    const cliHost = createCliProjectLikeHost({
      sessions: cliSessions,
      engine: cliEngine,
    });

    const vaultRuntime = new AgentCoreRuntime(vaultHost);
    const cliRuntime = new AgentCoreRuntime(cliHost);

    expect(vaultRuntime.workspaceId).toBe('vault-alpha');
    expect(vaultRuntime.workspaceKind).toBe('obsidian-vault');
    expect(cliRuntime.workspaceId).toBe('repo-cli-42');
    expect(cliRuntime.workspaceKind).toBe('cli-project');

    const vaultBound = await vaultRuntime.createSession();
    const cliBound = await cliRuntime.createSession();

    expect(vaultSessions.createPaths).toEqual(['file:///vaults/alpha']);
    expect(cliSessions.createPaths).toEqual(['file:///Users/dev/pivi-cli']);
    expect(vaultBound).toBe(vaultRef);
    expect(cliBound).toBe(cliRef);
    expect(vaultEngine.syncCalls).toEqual([
      { ref: { sessionFile: vaultRef.sessionFile, leafId: null }, paths: undefined },
    ]);
    expect(cliEngine.syncCalls).toEqual([
      { ref: { sessionFile: cliRef.sessionFile, leafId: 'leaf-cli' }, paths: undefined },
    ]);

    const vaultTools = await vaultRuntime.listToolSpecs({ workspaceKind: 'obsidian-vault' });
    const cliTools = await cliRuntime.listToolSpecs({ cwd: '/Users/dev/pivi-cli' });
    expect(vaultTools.map((t) => t.name)).toEqual(['obsidian_search']);
    expect(cliTools.map((t) => t.name)).toEqual(['bash']);

    const vaultHistory = await vaultRuntime.loadHistory();
    const cliHistory = await cliRuntime.loadHistory();
    expect(vaultHistory).toEqual([{ role: 'user', content: 'vault-history' }]);
    expect(cliHistory).toEqual([{ role: 'user', content: 'cli-history' }]);
    expect(vaultSessions.lastGetMessagesRef).toBe(vaultRef);
    expect(cliSessions.lastGetMessagesRef).toBe(cliRef);

    const vaultTurn = minimalTurn('vault turn');
    const cliTurn = minimalTurn('cli turn');
    const vaultChunks: StreamChunk[] = [];
    const cliChunks: StreamChunk[] = [];
    for await (const chunk of vaultRuntime.query(vaultTurn, vaultHistory)) {
      vaultChunks.push(chunk);
    }
    for await (const chunk of cliRuntime.query(cliTurn, cliHistory)) {
      cliChunks.push(chunk);
    }

    expect(vaultChunks).toEqual([{ type: 'text', content: 'vault-stream' }]);
    expect(cliChunks).toEqual([{ type: 'text', content: 'cli-stream' }]);
    expect(vaultEngine.queryCalls).toEqual([{ turn: vaultTurn, history: vaultHistory }]);
    expect(cliEngine.queryCalls).toEqual([{ turn: cliTurn, history: cliHistory }]);
    expect(vaultEngine.getSessionId()).toBe('vault-stream-sdk');
    expect(cliEngine.getSessionId()).toBe('cli-stream-sdk');
  });
});
