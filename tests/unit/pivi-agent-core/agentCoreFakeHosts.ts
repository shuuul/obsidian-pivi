import type { AgentEngine } from '@pivi/pivi-agent-core/engine';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ToolProvider } from '@pivi/pivi-agent-core/plugins';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  Logger,
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
  RuntimeUiCallbacks,
  SecretStore,
  WorkspaceFileStore,
} from '@pivi/pivi-agent-core/ports';
import type { AgentCoreHost } from '@pivi/pivi-agent-core/runtime/agentCoreHost';
import type { ChatTurnMetadata } from '@pivi/pivi-agent-core/runtime/types';
import type { SessionRef, SessionStore } from '@pivi/pivi-agent-core/session';
import type { WorkspaceContext } from '@pivi/pivi-agent-core/workspace';

export type FakeHostPortOverrides = {
  sessions?: SessionStore;
  engine?: AgentEngine;
};

function createInMemoryFileStore(seed: Record<string, string> = {}): WorkspaceFileStore {
  const files = new Map(Object.entries(seed));

  const missing = (path: string): never => {
    throw new Error(`ENOENT: ${path}`);
  };

  return {
    exists: async (path) => files.has(path),
    read: async (path) => files.get(path) ?? missing(path),
    write: async (path, content) => {
      files.set(path, content);
    },
    append: async (path, content) => {
      files.set(path, (files.get(path) ?? '') + content);
    },
    delete: async (path) => {
      files.delete(path);
    },
    deleteFolder: async () => {},
    listFiles: async () => [...files.keys()],
    listFolders: async () => [],
    listFilesRecursive: async () => [...files.keys()],
    ensureFolder: async () => {},
    rename: async (oldPath, newPath) => {
      const value = files.get(oldPath) ?? missing(oldPath);
      files.delete(oldPath);
      files.set(newPath, value);
    },
    stat: async (path) => {
      const value = files.get(path);
      if (value === undefined) return null;
      return { mtime: 0, size: value.length };
    },
  };
}

export function createTrackingSessionStore(
  label: string,
): SessionStore & { listedVaultPath: string | null } {
  const state = { listedVaultPath: null as string | null };
  const ref: SessionRef = {
    sessionFile: `${label}/sessions/one.jsonl`,
    leafId: null,
    sessionId: `${label}-session`,
  };

  return {
    get listedVaultPath() {
      return state.listedVaultPath;
    },
    listSessions: async (vaultPath) => {
      state.listedVaultPath = vaultPath;
      return [
        {
          sessionFile: ref.sessionFile,
          sessionId: ref.sessionId,
          title: `${label} session`,
          updatedAt: 2,
          leafCount: 0,
          messagePreview: '',
        },
      ];
    },
    create: async () => ref,
    open: async () => ref,
    getMessages: async () => [] as ChatMessage[],
    appendUserTurn: async () => ref,
    appendAgentTurn: async () => ref,
    fork: async () => ref,
    deleteSession: async () => {},
    readUiContext: async () => ({}),
    writeUiContext: async () => {},
    writeSessionMeta: async () => {},
    sessionRefFromOpenSession: () => ref,
  };
}

export function createTrackingEngine(
  label: string,
): AgentEngine & { lastSyncPath: string | null } {
  const state = { lastSyncPath: null as string | null };
  const emptyMetadata: ChatTurnMetadata = {};

  return {
    get lastSyncPath() {
      return state.lastSyncPath;
    },
    syncSession: (sessionRef) => {
      state.lastSyncPath = sessionRef?.sessionFile ?? null;
    },
    query: async function* () {
      yield { type: 'text', content: label };
    },
    cancel: () => {},
    resetSession: () => {},
    getSessionId: () => `${label}-sdk`,
    rewind: async () => ({ canRewind: true }),
    consumeTurnMetadata: () => emptyMetadata,
    cleanup: () => {},
  };
}

function createToolProvider(id: string, toolName: string): ToolProvider {
  return {
    id,
    listTools: async () => [
      {
        name: toolName,
        description: `${id} tool`,
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      },
    ],
  };
}

function createInMemorySecretStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getSecret: async (key) => values.get(key) ?? null,
    setSecret: async (key, value) => {
      values.set(key, value);
    },
    deleteSecret: async (key) => {
      values.delete(key);
    },
    listSecrets: async (prefix) =>
      [...values.keys()].filter((key) => (prefix ? key.startsWith(prefix) : true)),
  };
}

export function createObsidianLikeHost(overrides?: FakeHostPortOverrides): AgentCoreHost {
  const workspace: WorkspaceContext = {
    id: 'vault-alpha',
    name: 'Research Vault',
    kind: 'obsidian-vault',
    rootUri: 'file:///vaults/alpha',
    piviDir: '.pivi',
  };
  const files = createInMemoryFileStore({ 'notes/welcome.md': '# Welcome' });
  const secrets = createInMemorySecretStore();
  const ui: RuntimeUiCallbacks = {
    notify: jest.fn(),
    requestConfirmation: jest.fn(async () => true),
  };

  return {
    workspace,
    files,
    sessions: overrides?.sessions ?? createTrackingSessionStore('vault'),
    engine: overrides?.engine ?? createTrackingEngine('vault'),
    tools: [createToolProvider('obsidian-tools', 'obsidian_search')],
    contextProviders: [],
    secrets,
    ui,
    logger: undefined,
    network: undefined,
    process: undefined,
  };
}

export function createCliProjectLikeHost(overrides?: FakeHostPortOverrides): AgentCoreHost {
  const workspace: WorkspaceContext = {
    id: 'repo-cli-42',
    name: 'pivi-cli',
    kind: 'cli-project',
    rootUri: 'file:///Users/dev/pivi-cli',
    piviDir: '.pivi',
  };
  const files = createInMemoryFileStore({ 'package.json': '{"name":"pivi-cli"}' });
  const logger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const network: HttpClient = {
    fetch: jest.fn(async (_request: HttpRequest): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      headers: {},
      text: async () => 'ok',
      json: async <T = unknown>() => ({ ok: true }) as T,
    })),
  };
  const process: ProcessRunner = {
    run: jest.fn(async (_request: ProcessRunRequest): Promise<ProcessRunResult> => ({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
    })),
  };

  return {
    workspace,
    files,
    sessions: overrides?.sessions ?? createTrackingSessionStore('cli'),
    engine: overrides?.engine ?? createTrackingEngine('cli'),
    tools: [createToolProvider('cli-tools', 'bash')],
    contextProviders: [],
    logger,
    network,
    process,
  };
}
