const mockAgentInstances: Array<{
  initialState: { systemPrompt: string; messages: unknown[]; tools?: unknown[] };
  options: Record<string, unknown>;
  state: { systemPrompt: string; messages: unknown[]; tools?: unknown[] };
  listeners: Array<(event: any) => void>;
  prompt: jest.Mock;
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; messages: unknown[]; tools?: unknown[] };
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
        if (input === 'Use background subagent') {
          const spawnTool = (instance.state.tools ?? []).find((tool: unknown) => (
            !!tool
            && typeof tool === 'object'
            && (tool as { name?: unknown }).name === 'spawn_agent'
          )) as { execute: (id: string, args: Record<string, unknown>) => Promise<unknown> } | undefined;
          if (!spawnTool) throw new Error('spawn_agent not registered');
          const userMessage = { role: 'user', content: input };
          const assistantToolCall = {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'spawn-1',
              name: 'spawn_agent',
              arguments: { message: 'read card', run_in_background: true },
            }],
          };
          const finalAssistant = { role: 'assistant', content: 'Final synthesis from subagent report' };
          for (const listener of [...listeners]) {
            listener({ type: 'turn_start' });
            listener({ type: 'message_end', message: userMessage });
            listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
            listener({
              type: 'tool_execution_start',
              toolCallId: 'spawn-1',
              toolName: 'spawn_agent',
              args: { message: 'read card', run_in_background: true },
            });
          }
          const result = await spawnTool.execute('spawn-1', { message: 'read card', run_in_background: true });
          const toolResultMessage = {
            role: 'toolResult',
            toolCallId: 'spawn-1',
            toolName: 'spawn_agent',
            content: (result as { content?: unknown }).content ?? [],
            isError: false,
          };
          instance.state.messages = [userMessage, assistantToolCall, toolResultMessage, finalAssistant];
          for (const listener of [...listeners]) {
            listener({
              type: 'tool_execution_end',
              toolCallId: 'spawn-1',
              toolName: 'spawn_agent',
              result,
              isError: false,
            });
            listener({ type: 'message_end', message: assistantToolCall });
            listener({ type: 'message_end', message: toolResultMessage });
            listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
            listener({
              type: 'message_update',
              message: {} as any,
              assistantMessageEvent: {
                type: 'text_delta',
                contentIndex: 0,
                delta: 'Final synthesis from subagent report',
                partial: {} as any,
              },
            });
            listener({ type: 'message_end', message: finalAssistant });
            listener({ type: 'agent_end', messages: instance.state.messages });
          }
          return;
        }
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
  spawn: jest.fn(async () => ({
    agentId: 'subagent-1',
    maxConcurrentSubagents: 3,
    queuePosition: null,
    queued: false,
    runningAtRequest: 0,
    runningAtStart: 1,
  })),
  waitForResult: jest.fn(async () => ({ status: 'completed' as const, result: 'subagent report' })),
  loadSubagentToolCalls: jest.fn(async () => []),
  loadSubagentFinalResult: jest.fn(async () => null),
  reset: jest.fn(),
  cleanupIdleSubagents: jest.fn(),
  abortAllSubagents: jest.fn(),
};
let mockCapturedSubagentToolProvider: (() => unknown[]) | undefined;
let mockCapturedSubagentChunkSink: ((chunk: StreamChunk) => void) | undefined;

jest.mock('@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner', () => ({
  createPiAuxQueryRunner: jest.fn((_plugin, options) => {
    mockCapturedSubagentChunkSink = options?.onSubagentChunk;
    mockCapturedSubagentToolProvider = options?.getTools;
    return mockAuxRunner;
  }),
}));

import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { HttpClient } from '@pivi/pivi-agent-core/ports';
import type { StreamChunk, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import * as piAiModelRegistry from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { PiChatRuntime } from '@pivi/pivi-agent-core/engine/pi/piChatRuntime';
import {
  type PiCachedModel,
  PI_AI_MODELS_CACHE,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import { TOOL_OBSIDIAN_READ_EXTERNAL, TOOL_SPAWN_AGENT, type ToolSpec } from '@pivi/pivi-agent-core/tools';

function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}

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
    obsidianCliAvailable: true,
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
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
  return new PiChatRuntime(plugin, testNetwork, null, null, testBaseToolProvider);
}

function localModelFixture(contextWindowIsAuthoritative: boolean): PiCachedModel {
  return {
    id: 'preflight-model',
    name: 'Preflight model',
    provider: 'lmstudio',
    api: 'openai-completions',
    baseUrl: 'http://localhost:1234/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    contextWindowIsAuthoritative,
    maxTokens: 4096,
  };
}

describe('PiChatRuntime system prompt', () => {
  beforeEach(() => {
    PI_AI_MODELS_CACHE.clear();
    mockAgentInstances.length = 0;
    mockAuxRunner.query.mockClear();
    mockAuxRunner.spawn.mockClear();
    mockAuxRunner.waitForResult.mockClear();
    mockAuxRunner.loadSubagentToolCalls.mockClear();
    mockAuxRunner.loadSubagentFinalResult.mockClear();
    mockAuxRunner.reset.mockClear();
    mockAuxRunner.cleanupIdleSubagents.mockClear();
    mockAuxRunner.abortAllSubagents.mockClear();
    mockCapturedSubagentToolProvider = undefined;
    mockCapturedSubagentChunkSink = undefined;
    process.env.OPENCODE_API_KEY = 'test-key';
    testHttpFetch.mockReset();
  });

  afterEach(() => {
    PI_AI_MODELS_CACHE.clear();
    delete process.env.OPENCODE_API_KEY;
    delete process.env.LMSTUDIO_API_KEY;
  });

  it('initializes agent with buildSystemPrompt output', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    const agent = mockAgentInstances[0];
    expectDefined(agent);
    expect(agent.initialState.systemPrompt).toContain('You are **Pivi**');
    expect(agent.initialState.systemPrompt).not.toContain('## Custom Instructions');
    expect(agent.initialState.systemPrompt).toContain('Vault absolute path: /test/vault');
    expect(agent.options).not.toHaveProperty('getApiKey');
  });

  it('does not pass spawn_agent to child subagents even if a provider exposes it', async () => {
    const plugin = createMockPlugin();
    const providerWithSpawnAgent: PiBaseToolProvider = () => ({
      toolSpecs: [
        {
          name: TOOL_SPAWN_AGENT,
          description: 'Should not be reachable from child subagents',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          async execute() {
            return { content: [{ type: 'text', text: 'unexpected' }], details: {} };
          },
        } satisfies ToolSpec,
        {
          name: 'obsidian_read',
          description: 'Allowed base tool',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          async execute() {
            return { content: [{ type: 'text', text: 'ok' }], details: {} };
          },
        } satisfies ToolSpec,
      ],
      registeredToolSummary: {
        obsidianTools: [],
        obsidianCliAvailable: true,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        includeWebSearch: false,
      },
    });

    new PiChatRuntime(plugin, testNetwork, null, null, providerWithSpawnAgent);

    const childTools = mockCapturedSubagentToolProvider?.() ?? [];
    expect(childTools.map((tool) => (tool as { name: string }).name)).toEqual(['obsidian_read']);
  });


  it('syncSystemPrompt hot-updates without recreating agent', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();
    const firstAgent = mockAgentInstances[0];
    const initialMessages = [{ role: 'user', content: 'hello' }];
    expectDefined(firstAgent);
    firstAgent.state.messages = initialMessages;

    plugin.settings.userName = 'Alice';
    await runtime.syncSystemPrompt();

    expect(mockAgentInstances).toHaveLength(1);
    expect(firstAgent.state.messages).toBe(initialMessages);
    expect(firstAgent.state.systemPrompt).toContain('**Alice**');
  });

  it('syncSystemPrompt hot-updates registered tools without recreating agent', async () => {
    const plugin = createMockPlugin();
    let includeExternalTool = false;
    const provider: PiBaseToolProvider = () => ({
      toolSpecs: includeExternalTool
        ? [{
          name: TOOL_OBSIDIAN_READ_EXTERNAL,
          description: 'Read external fixture',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          async execute() {
            return { content: [{ type: 'text', text: 'ok' }], details: {} };
          },
        } satisfies ToolSpec]
        : [],
      registeredToolSummary: {
        obsidianTools: includeExternalTool ? [TOOL_OBSIDIAN_READ_EXTERNAL] : [],
        obsidianCliAvailable: true,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        includeWebSearch: false,
      },
    });
    const runtime = new PiChatRuntime(plugin, testNetwork, null, null, provider);

    await runtime.ensureReady();
    const agent = mockAgentInstances[0];
    expectDefined(agent);
    expect((agent.state.tools ?? []).map((tool) => (tool as { name?: string }).name))
      .not.toContain(TOOL_OBSIDIAN_READ_EXTERNAL);

    includeExternalTool = true;
    await runtime.syncSystemPrompt();

    expect(mockAgentInstances).toHaveLength(1);
    expect((agent.state.tools ?? []).map((tool) => (tool as { name?: string }).name))
      .toContain(TOOL_OBSIDIAN_READ_EXTERNAL);
    expect(agent.state.systemPrompt).toContain(`\`${TOOL_OBSIDIAN_READ_EXTERNAL}\``);
  });

  it('ensureReady without force applies prompt changes without rebuild', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    await runtime.ensureReady();
    plugin.settings.userName = 'Alice';
    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expectDefined(mockAgentInstances[0]);
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
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('Hi Pi');
    expect(chunks).toEqual([
      { type: 'assistant_message_start' },
      { type: 'text', content: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('refreshes local model metadata once after the first prompt loads the model', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    const refreshSpy = jest
      .spyOn(piAiModelRegistry, 'refreshCustomPiProviderModels')
      .mockImplementation(async () => {
        expect(mockAgentInstances[0]?.prompt).toHaveBeenCalledWith('First');
        return true;
      });
    const plugin = createMockPlugin({
      model: 'lmstudio/local-model',
      visibleModels: ['lmstudio/local-model'],
    });
    const runtime = createRuntime(plugin);

    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: 'First' }))) {
      // Drain the stream.
    }
    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: 'Second' }))) {
      // Drain the stream.
    }

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith('lmstudio');
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledTimes(2);
    refreshSpy.mockRestore();
  });

  it('retries local model metadata refresh after a transient failure', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    const warningSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const refreshSpy = jest
      .spyOn(piAiModelRegistry, 'refreshCustomPiProviderModels')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(true);
    const plugin = createMockPlugin({
      model: 'lmstudio/local-model',
      visibleModels: ['lmstudio/local-model'],
    });
    const runtime = createRuntime(plugin);

    for (const text of ['First', 'Second', 'Third']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Drain the stream.
      }
    }

    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledTimes(3);
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining('temporary failure'),
    );
    refreshSpy.mockRestore();
    warningSpy.mockRestore();
  });

  it('rechecks external context availability and appends it to every API turn', async () => {
    const plugin = createMockPlugin();
    let available = true;
    const provider = jest.fn<ReturnType<PiBaseToolProvider>, Parameters<PiBaseToolProvider>>((options) => ({
      toolSpecs: [],
      externalContexts: (options.externalContextPaths ?? []).map((path) => ({
        path,
        available,
        ...(!available ? { reason: 'not-found' } : {}),
      })),
      registeredToolSummary: {
        obsidianTools: [],
        obsidianCliAvailable: true,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        includeWebSearch: false,
      },
    }));
    const runtime = new PiChatRuntime(plugin, testNetwork, null, null, provider);

    for await (const _chunk of runtime.query(runtime.prepareTurn({
      text: 'First turn',
      externalContextPaths: ['/external/project'],
    }))) {
      // Drain the stream.
    }

    available = false;
    for await (const _chunk of runtime.query(runtime.prepareTurn({
      text: 'Second turn',
      externalContextPaths: ['/external/project'],
    }))) {
      // Drain the stream.
    }

    expectDefined(mockAgentInstances[0]);
    const prompts = mockAgentInstances[0].prompt.mock.calls.map(([prompt]) => String(prompt));
    expect(prompts[0]).toContain('<context path="/external/project" available="true" />');
    expect(prompts[1]).toContain(
      '<context path="/external/project" available="false" reason="not-found" />',
    );
    expect(provider.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not inject turn-local subagent policy into prompts or persisted session content', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const turn = runtime.prepareTurn({
      text: 'Compare these notes',
      attachedFilePaths: ['notes/a.md', 'notes/b.md'],
    });

    expect(turn.prompt).toContain('<context_files>');
    expect(turn.prompt).not.toContain('<subagent_delegation_policy>');
    expect(turn.persistedContent).not.toContain('<subagent_delegation_policy>');

    for await (const _chunk of runtime.query(turn)) {
      // Drain the stream so the user entry is persisted.
    }

    const sessionFile = runtime.getSessionStateUpdates().sessionFile;
    const store = SessionTreeStore.open('/test/vault', sessionFile ?? '');
    const persistedUser = store.getEntries().find((entry) => (
      entry.type === 'message'
      && entry.message.role === 'user'
      && String(entry.message.content).includes('Compare these notes')
    ));

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith(expect.not.stringContaining('<subagent_delegation_policy>'));
    expect(persistedUser?.type).toBe('message');
    expect((persistedUser as { message: { content: string } } | undefined)?.message.content)
      .toContain('<context_files>');
    expect((persistedUser as { message: { content: string } } | undefined)?.message.content)
      .not.toContain('<subagent_delegation_policy>');
  });

  it('keeps a background subagent inside the main turn until the final report is synthesized', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Use background subagent' }))) {
      chunks.push(chunk);
    }

    const toolResult = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'tool_result' }> => (
      chunk.type === 'tool_result' && chunk.id === 'spawn-1'
    ));
    expect(mockAuxRunner.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'spawn-1' }),
      'read card',
    );
    expect(mockAuxRunner.waitForResult).toHaveBeenCalledWith('subagent-1');
    expect(toolResult?.content).toContain('subagent report');
    expect(toolResult?.toolUseResult).toEqual({
      agent_id: 'subagent-1',
      concurrency: {
        max_concurrent_subagents: 3,
        queue_position: null,
        queued: false,
        running_at_request: 0,
        running_at_start: 1,
      },
      status: 'completed',
      result: 'subagent report',
    });

    const finalTextIndex = chunks.findIndex((chunk) => (
      chunk.type === 'text' && chunk.content === 'Final synthesis from subagent report'
    ));
    const doneIndex = chunks.findIndex((chunk) => chunk.type === 'done');
    expect(finalTextIndex).toBeGreaterThan(-1);
    expect(doneIndex).toBeGreaterThan(finalTextIndex);
  });

  it('delivers background subagent chunks after the parent turn stream ends', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const chunks: StreamChunk[] = [];
    runtime.onSubagentChunk((chunk) => {
      chunks.push(chunk);
    });

    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: 'Hi Pi' }))) {
      // Drain the parent turn so activeTurn is cleared.
    }

    mockCapturedSubagentChunkSink?.({
      type: 'async_subagent_result',
      agentId: 'subagent-late',
      subagentId: 'spawn-late',
      status: 'completed',
      result: 'late result',
    });
    await Promise.resolve();

    expect(chunks).toEqual([
      {
        type: 'async_subagent_result',
        agentId: 'subagent-late',
        subagentId: 'spawn-late',
        status: 'completed',
        result: 'late result',
      },
    ]);
  });

  it('does not route old background subagent chunks into a later active turn', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const queuedChunks: StreamChunk[] = [];
    const listenerChunks: StreamChunk[] = [];
    runtime.onSubagentChunk((chunk) => {
      listenerChunks.push(chunk);
    });

    (runtime as unknown as {
      activeTurn: {
        queue: { push(chunk: StreamChunk): void; close(): void };
        acceptingSubagentChunks: boolean;
        subagentToolIds: Set<string>;
      };
    }).activeTurn = {
      queue: {
        push: (chunk) => { queuedChunks.push(chunk); },
        close: jest.fn(),
      },
      acceptingSubagentChunks: true,
      subagentToolIds: new Set(['current-spawn']),
    };

    mockCapturedSubagentChunkSink?.({ type: 'subagent_text', subagentId: 'old-spawn', content: 'old' });
    mockCapturedSubagentChunkSink?.({ type: 'subagent_text', subagentId: 'current-spawn', content: 'current' });
    await Promise.resolve();

    expect(listenerChunks).toEqual([{ type: 'subagent_text', subagentId: 'old-spawn', content: 'old' }]);
    expect(queuedChunks).toEqual([{ type: 'subagent_text', subagentId: 'current-spawn', content: 'current' }]);
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
    expectDefined(mockAgentInstances[0]);
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

  it('does not recompact compacted-away raw history on a small follow-up turn', async () => {
    const plugin = createMockPlugin({
      enableAutoCompact: true,
      autoCompactThresholdRatio: 0.5,
      autoCompactKeepRecentTokens: 1_000,
    });
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
    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: '/compact keep essentials' }))) {
      // Drain manual compaction.
    }
    mockAuxRunner.query.mockClear();
    mockAuxRunner.reset.mockClear();

    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Small follow-up' }))) {
      chunks.push(chunk);
    }

    expect(mockAuxRunner.query).not.toHaveBeenCalled();
    expect(chunks).not.toContainEqual({ type: 'context_compacting' });
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenLastCalledWith('Small follow-up');
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
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenLastCalledWith('Continue after preflight compaction');
  });

  it('does not reject a first local turn using a synthetic context window', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    PI_AI_MODELS_CACHE.set(
      'lmstudio/preflight-model',
      localModelFixture(false),
    );
    const refreshSpy = jest
      .spyOn(piAiModelRegistry, 'refreshCustomPiProviderModels')
      .mockResolvedValue(false);
    const plugin = createMockPlugin({
      model: 'lmstudio/preflight-model',
      visibleModels: ['lmstudio/preflight-model'],
      enableAutoCompact: true,
      autoCompactThresholdRatio: 0.5,
    });
    const runtime = createRuntime(plugin);
    const oversizedForFallback = 'x'.repeat(12_000);
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: oversizedForFallback }))) {
      chunks.push(chunk);
    }

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith(oversizedForFallback);
    expect(chunks).not.toContainEqual(expect.objectContaining({
      type: 'error',
      content: expect.stringContaining('too large'),
    }));
    refreshSpy.mockRestore();
  });

  it('keeps preflight limits for an authoritative local context window', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    PI_AI_MODELS_CACHE.set(
      'lmstudio/preflight-model',
      localModelFixture(true),
    );
    const plugin = createMockPlugin({
      model: 'lmstudio/preflight-model',
      visibleModels: ['lmstudio/preflight-model'],
      enableAutoCompact: true,
      autoCompactThresholdRatio: 0.5,
    });
    const runtime = createRuntime(plugin);
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'x'.repeat(12_000) }))) {
      chunks.push(chunk);
    }

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).not.toHaveBeenCalled();
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'error',
      content: expect.stringContaining('too large'),
    }));
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
    const firstUsageChunk = usageChunks[0];
    const finalUsageChunk = usageChunks.at(-1);
    expectDefined(firstUsageChunk);
    expectDefined(finalUsageChunk);
    expect(firstUsageChunk.usage.contextTokens).toBeGreaterThan(0);
    expect(firstUsageChunk.usage.contextTokens).not.toBe(300);
    expect(finalUsageChunk.usage.contextTokens).toBe(300);
  });

  it('does not expose the compaction fallback as a UI context window', () => {
    const runtime = createRuntime(createMockPlugin({
      model: 'missing-model',
      visibleModels: ['missing-model'],
    }));
    jest.spyOn(
      runtime as unknown as { resolveModel: () => unknown },
      'resolveModel',
    ).mockReturnValue(null);
    const usageBuilder = runtime as unknown as {
      buildEstimatedUsageInfo(messages: unknown[]): UsageInfo | null;
      buildUsageInfo(message: unknown): UsageInfo | null;
    };

    expect(usageBuilder.buildEstimatedUsageInfo([
      { role: 'user', content: 'Unknown model usage' },
    ])).toMatchObject({ contextWindow: 0, percentage: 0 });
    expect(usageBuilder.buildUsageInfo({
      role: 'assistant',
      usage: { input: 300, output: 10, totalTokens: 310 },
    })).toMatchObject({ contextWindow: 0, percentage: 0 });
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
    expectDefined(mockAgentInstances[0]);
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
    expectDefined(mockAgentInstances[0]);
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
