const mockAgentInstances: Array<{
  initialState: { systemPrompt: string; messages: unknown[] };
  options: Record<string, unknown>;
  state: { systemPrompt: string; messages: unknown[] };
  listeners: Array<(event: any) => void>;
  prompt: jest.Mock;
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; messages: unknown[] };
    [key: string]: unknown;
  }) => {
    const listeners: Array<(event: any) => void> = [];
    const instance = {
      initialState: options.initialState,
      options,
      state: { ...options.initialState },
      listeners,
      subscribe: jest.fn((listener: (event: any) => void) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      }),
      prompt: jest.fn(async (input: string) => {
        if (input === 'Trigger tool usage update') {
          const messages = [
            { role: 'user', content: input },
            {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'call-1', name: 'obsidian_read', arguments: { path: 'A.md' } }],
            },
            {
              role: 'toolResult',
              toolCallId: 'call-1',
              toolName: 'obsidian_read',
              content: [{ type: 'text', text: 'x'.repeat(1000) }],
              isError: false,
            },
            {
              role: 'assistant',
              content: 'Done',
              usage: { input: 300, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 310 },
              provider: 'opencode-go',
              model: 'deepseek-v4-flash',
            },
          ];
          instance.state.messages = messages;
          for (const listener of [...listeners]) {
            listener({ type: 'turn_start' });
            listener({ type: 'message_end', message: messages[0] });
            listener({ type: 'message_end', message: messages[1] });
            listener({
              type: 'tool_execution_end',
              toolCallId: 'call-1',
              toolName: 'obsidian_read',
              result: { content: [{ type: 'text', text: 'x'.repeat(1000) }] },
              isError: false,
            });
            listener({ type: 'message_end', message: messages[2] });
            listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
            listener({
              type: 'message_update',
              message: {} as any,
              assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done', partial: {} as any },
            });
            listener({ type: 'message_end', message: messages[3] });
            listener({ type: 'agent_end', messages });
          }
          return;
        }
        instance.state.messages = [
          { role: 'user', content: input },
          { role: 'assistant', content: 'Hello' },
        ];
        for (const listener of [...listeners]) {
          listener({ type: 'turn_start' });
          listener({ type: 'message_end', message: { role: 'user', content: input } });
          listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
          listener({
            type: 'message_update',
            message: {} as any,
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} as any },
          });
          listener({ type: 'message_end', message: { role: 'assistant', content: 'Hello' } });
          listener({ type: 'agent_end', messages: [] });
        }
      }),
      abort: jest.fn(),
      reset: jest.fn(),
      sessionId: undefined,
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

const mockAuxRunner = {
  query: jest.fn(async () => 'Compacted session summary.'),
  reset: jest.fn(),
};

jest.mock('@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner', () => ({
  createPiAuxQueryRunner: jest.fn(() => mockAuxRunner),
}));

import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { HttpClient } from '@pivi/pivi-agent-core/ports';
import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import { PiChatRuntime } from '@pivi/pivi-agent-core/engine/pi/piChatRuntime';
import type { PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';

function createMockPlugin(overrides: {
  userName?: string;
  vaultPath?: string | null;
  model?: string;
  environmentVariables?: string;
  visibleModels?: string[];
  enableAutoCompact?: boolean;
  autoCompactThresholdRatio?: number;
  autoCompactKeepRecentTokens?: number;
} = {}): {
  settings: {
    model: string;
    userName: string;
    sharedEnvironmentVariables: string;
    enableAutoCompact: boolean;
    autoCompactThresholdRatio: number;
    autoCompactKeepRecentTokens: number;
    agentSettings: {
      environmentVariables: string;
      visibleModels: string[];
    };
  };
  app: { vault: { adapter: { basePath: string } } };
  getVaultPath(): string | null;
} {
  return {
    settings: {
      model: overrides.model ?? 'opencode-go/deepseek-v4-flash',
      userName: overrides.userName ?? '',
      sharedEnvironmentVariables: '',
      enableAutoCompact: overrides.enableAutoCompact ?? false,
      autoCompactThresholdRatio: overrides.autoCompactThresholdRatio ?? 0.9,
      autoCompactKeepRecentTokens: overrides.autoCompactKeepRecentTokens ?? 1_000,
      agentSettings: {
        environmentVariables: overrides.environmentVariables ?? 'OPENCODE_API_KEY=test-key',
        visibleModels: overrides.visibleModels ?? ['opencode-go/deepseek-v4-flash'],
      },
    },
    app: {
      vault: {
        adapter: {
          basePath: '/test/vault',
        },
      },
    },
    getVaultPath: () => ('vaultPath' in overrides ? overrides.vaultPath ?? null : '/test/vault'),
  };
}

const testBaseToolProvider: PiBaseToolProvider = () => ({
  toolSpecs: [],
  registeredToolSummary: {
    obsidianTools: [],
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
    allowCommand: false,
    allowEval: false,
  },
});

const testHttpFetch = jest.fn();

const testNetwork = {
  httpClient: {
    fetch: testHttpFetch,
  } satisfies HttpClient,
  mcpFetch: jest.fn() as unknown as McpTransportFetch,
  mcpProcessEnv: {},
};

function createRuntime(plugin: ReturnType<typeof createMockPlugin>): PiChatRuntime {
  return new PiChatRuntime(plugin as never, testNetwork, null, null, testBaseToolProvider);
}

describe('PiChatRuntime system prompt', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    mockAuxRunner.query.mockClear();
    mockAuxRunner.reset.mockClear();
    process.env.OPENCODE_API_KEY = 'test-key';
    testHttpFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
  });

  it('initializes agent with buildSystemPrompt output', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    const agent = mockAgentInstances[0];
    expect(agent.initialState.systemPrompt).toContain('You are **Pivi**');
    expect(agent.initialState.systemPrompt).not.toContain('## Custom Instructions');
    expect(agent.initialState.systemPrompt).toContain('Vault absolute path: /test/vault');
    expect(agent.options).not.toHaveProperty('getApiKey');
  });


  it('syncSystemPrompt hot-updates without recreating agent', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();
    const firstAgent = mockAgentInstances[0];
    const initialMessages = [{ role: 'user', content: 'hello' }];
    firstAgent.state.messages = initialMessages;

    plugin.settings.userName = 'Alice';
    await runtime.syncSystemPrompt();

    expect(mockAgentInstances).toHaveLength(1);
    expect(firstAgent.state.messages).toBe(initialMessages);
    expect(firstAgent.state.systemPrompt).toContain('**Alice**');
  });

  it('ensureReady without force applies prompt changes without rebuild', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();
    plugin.settings.userName = 'Alice';
    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].state.systemPrompt).toContain('**Alice**');
  });

  it('persists session file without exposing legacy leaf id in session state updates', () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    runtime.syncSession({ sessionFile: '.pivi/sessions/a.jsonl', leafId: 'entry-1' });

    const updates = runtime.getSessionStateUpdates();

    expect(updates.agentState).toBeUndefined();
    expect(updates).toMatchObject({
      sessionFile: expect.any(String),
      sessionId: expect.any(String),
    });
    expect(updates.leafId).toBeUndefined();
  });

  it('resumes from an explicit session file binding', () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    runtime.syncSession({ sessionFile: '.pivi/sessions/legacy.jsonl' });

    const updates = runtime.getSessionStateUpdates();

    expect(updates.agentState).toBeUndefined();
    expect(updates.sessionFile).toEqual(expect.any(String));
  });

  it('streams adapted chunks from query and sends the prepared prompt to the agent', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const turn = runtime.prepareTurn({ text: 'Hi Pi' });

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(turn)) {
      chunks.push(chunk);
    }

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('Hi Pi');
    expect(chunks).toEqual([
      { type: 'assistant_message_start' },
      { type: 'text', content: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('handles /compact as session compaction instead of sending it as a prompt', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    for (const text of [
      'Old turn '.repeat(400),
      'Middle turn '.repeat(400),
      'Recent turn '.repeat(400),
    ]) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Drain the stream so each turn is persisted before compacting.
      }
    }

    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: '/compact preserve decisions' }))) {
      chunks.push(chunk);
    }

    expect(mockAuxRunner.query).toHaveBeenCalledTimes(1);
    expect((mockAuxRunner.query.mock.calls[0] as unknown[])[1]).toContain('preserve decisions');
    expect(mockAuxRunner.reset).toHaveBeenCalledTimes(1);
    expect(mockAgentInstances[0].prompt).not.toHaveBeenCalledWith('/compact preserve decisions');
    expect(chunks).toEqual([{ type: 'context_compacted' }, { type: 'done' }]);
    expect(mockAgentInstances[0].state.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Compacted session summary.'),
          }),
        ]),
      }),
    ]));
  });

  it('compacts before sending a turn that would exceed the context threshold', async () => {
    const plugin = createMockPlugin({
      enableAutoCompact: false,
      autoCompactThresholdRatio: 0.5,
      autoCompactKeepRecentTokens: 1_000,
    });
    const runtime = createRuntime(plugin);
    for (let i = 0; i < 5; i++) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text: `Turn ${i} ${'x'.repeat(100_000)}` }))) {
        // Drain the stream so session history grows past the preflight threshold.
      }
    }
    plugin.settings.enableAutoCompact = true;
    mockAuxRunner.query.mockClear();
    mockAuxRunner.reset.mockClear();

    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Continue after preflight compaction' }))) {
      chunks.push(chunk);
    }

    expect(mockAuxRunner.query).toHaveBeenCalledTimes(1);
    expect((mockAuxRunner.query.mock.calls[0] as unknown[])[1]).toContain('Preflight compaction');
    expect(chunks.slice(0, 2)).toEqual([
      { type: 'context_compacting' },
      { type: 'context_compacted' },
    ]);
    expect(mockAgentInstances[0].prompt).toHaveBeenLastCalledWith('Continue after preflight compaction');
  });

  it('emits an estimated usage update after tool results before final assistant usage', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const chunks = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Trigger tool usage update' }))) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage');
    expect(usageChunks.length).toBeGreaterThanOrEqual(2);
    expect(usageChunks[0].usage.contextTokens).toBeGreaterThan(0);
    expect(usageChunks[0].usage.contextTokens).not.toBe(300);
    expect(usageChunks[usageChunks.length - 1].usage.contextTokens).toBe(300);
  });

  it('resumes with persisted session messages when a session file is already open', async () => {
    const plugin = createMockPlugin();
    const seedRuntime = createRuntime(plugin);
    const seedTurn = seedRuntime.prepareTurn({ text: 'Earlier user message' });
    for await (const _chunk of seedRuntime.query(seedTurn)) {
      // Drain the stream so the in-memory session tree records the turn.
    }
    const seedUpdates = seedRuntime.getSessionStateUpdates();
    mockAgentInstances.length = 0;

    const resumedRuntime = createRuntime(plugin);
    resumedRuntime.syncSession({ sessionFile: seedUpdates.sessionFile ?? null });
    await resumedRuntime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].initialState.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Earlier user message' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    ]));
  });

  it('starts without a vault path and omits the path from the system prompt', async () => {
    const plugin = createMockPlugin({ vaultPath: null });
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].initialState.systemPrompt).not.toContain('Vault absolute path:');
  });

  it('preserves session file bindings without creating a session tree when the host has no vault path', () => {
    const plugin = createMockPlugin({ vaultPath: null });
    const runtime = createRuntime(plugin);

    runtime.syncSession({ sessionFile: '.pivi/sessions/missing.jsonl' });

    expect(runtime.getSessionStateUpdates()).toEqual({
      sessionId: null,
      sessionFile: '.pivi/sessions/missing.jsonl',
      agentState: undefined,
    });
  });

  it('getSessionStateUpdates returns current session binding when no session has been created', () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    runtime.syncSession({ sessionFile: null, leafId: null });

    const updates = runtime.getSessionStateUpdates();

    expect(updates).toEqual({
      sessionId: null,
      sessionFile: undefined,
      agentState: undefined,
    });
  });
});
