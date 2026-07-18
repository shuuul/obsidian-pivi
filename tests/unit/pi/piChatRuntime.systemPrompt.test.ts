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
let mockCapturedSubagentToolProvider: ((
  resolveReadMaxChars: (requestedMaxChars?: number) => number,
) => unknown[]) | undefined;
let mockCapturedSubagentChunkSink: ((chunk: StreamChunk) => void) | undefined;

jest.mock('@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner', () => ({
  createPiAuxQueryRunner: jest.fn((_plugin, options) => {
    mockCapturedSubagentChunkSink = options?.onSubagentChunk;
    mockCapturedSubagentToolProvider = options?.getTools;
    return mockAuxRunner;
  }),
}));

const defaultCompactionSample = `\`\`\`pivi-checkpoint
${JSON.stringify({
  continuationSummary: 'Continue from the compacted session with all verified vault decisions and evidence. '.repeat(12),
  goal: 'Finish checkpoint presentation.',
  constraints: ['Keep estimates explicit.'],
  decisions: ['Use the Memory boundary.'],
  artifacts: [{ label: 'Spec', vaultPath: 'specs/018-vault-context-compaction-redesign.md' }],
  openWork: ['Verify the live path.'],
  unresolvedQuestions: [],
  nextSteps: ['Run focused tests.'],
})}
\`\`\``;
const mockCompactionSample = jest.fn(async (..._args: unknown[]) => defaultCompactionSample);

jest.mock('@pivi/pivi-agent-core/engine/pi/piCompactionSampler', () => ({
  sampleCompactionNote: (...args: unknown[]) => mockCompactionSample(...args),
}));

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { HttpClient } from '@pivi/pivi-agent-core/ports';
import type { StreamChunk, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import * as piAiModelRegistry from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { PiChatRuntime } from '@pivi/pivi-agent-core/engine/pi/piChatRuntime';
import {
  buildEstimatedUsageInfo,
  buildUsageInfoFromAgentMessage,
} from '../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeUsage';
import {
  compactCurrentSession,
  prepareCompactionPrefire,
} from '../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeCompaction';
import {
  type PiCachedModel,
  PI_AI_MODELS_CACHE,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import { PIVI_MESSAGE_UI } from '@pivi/pivi-agent-core/session';
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
} = {}): {
  settings: {
    model: string;
    userName: string;
    sharedEnvironmentVariables: string;
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
    mockCompactionSample.mockClear();
    mockCompactionSample.mockResolvedValue(defaultCompactionSample);
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

    const childTools = mockCapturedSubagentToolProvider?.(() => 12_345) ?? [];
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

  it('persists command badge text while sending the expanded prompt to the agent', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const turn = runtime.prepareTurn({ text: 'Review the selected code in detail.' });
    turn.displayContent = '/review';

    for await (const _chunk of runtime.query(turn)) {
      // Drain the stream so both the user message and its UI overlay are persisted.
    }

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('Review the selected code in detail.');
    const sessionFile = runtime.getSessionStateUpdates().sessionFile;
    const messageUi = SessionTreeStore.open('/test/vault', sessionFile ?? '').getEntries().find((entry) => (
      entry.type === 'custom' && entry.customType === PIVI_MESSAGE_UI
    ));
    expect(messageUi).toEqual(expect.objectContaining({
      data: expect.objectContaining({ displayContent: '/review' }),
    }));
  });

  it('does not prompt the agent when pre-prompt user persistence fails', async () => {
    const persistUser = jest.spyOn(SessionTreeStore.prototype, 'appendUserMessage')
      .mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Do not lose this' }))) {
      chunks.push(chunk);
    }

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).not.toHaveBeenCalled();
    expect(chunks).toContainEqual({
      type: 'error',
      content: 'Failed to persist user message before prompt: disk unavailable',
    });
    persistUser.mockRestore();
  });

  it('surfaces a post-turn persistence failure instead of silently losing history', async () => {
    const syncMessages = jest.spyOn(SessionTreeStore.prototype, 'syncAgentMessages')
      .mockImplementationOnce(() => { throw new Error('session append failed'); });
    const runtime = createRuntime(createMockPlugin());
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Persist this reply' }))) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: 'error',
      content: 'session append failed',
    });
    syncMessages.mockRestore();
  });

  it('persists the completed assistant and tool sequence after the user prompt', async () => {
    const runtime = createRuntime(createMockPlugin());

    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: 'Trigger tool usage update' }))) {
      // Drain the complete turn before reopening its durable session.
    }

    const sessionFile = runtime.getSessionStateUpdates().sessionFile;
    expect(sessionFile).toEqual(expect.any(String));
    const persistedRoles = SessionTreeStore.open('/test/vault', sessionFile ?? '')
      .getEntries()
      .filter(entry => entry.type === 'message')
      .map(entry => entry.message.role);

    expect(persistedRoles).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
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

  it('never persists external context paths in the direct runtime message UI snapshot', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);

    for await (const _chunk of runtime.query(runtime.prepareTurn({
      text: 'Inspect external project',
      externalContextPaths: ['/Users/example/private-project'],
    }))) {
      // Drain the stream so the user entry and UI snapshot are persisted.
    }

    const sessionFile = runtime.getSessionStateUpdates().sessionFile;
    const entries = SessionTreeStore.open('/test/vault', sessionFile ?? '').getEntries();
    const messageUi = entries.find((entry) => (
      entry.type === 'custom' && entry.customType === PIVI_MESSAGE_UI
    ));
    expect(messageUi).toBeDefined();
    expect(JSON.stringify(messageUi)).not.toContain('externalContextPaths');
    expect(JSON.stringify(messageUi)).not.toContain('/Users/example/private-project');
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

    expect(mockCompactionSample).toHaveBeenCalledTimes(2);
    expect((mockCompactionSample.mock.calls[1] as unknown[])[2]).toContain('preserve decisions');
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).not.toHaveBeenCalledWith('/compact preserve decisions');
    expect(chunks).toEqual([
      expect.objectContaining({
        type: 'context_compacted',
        tokensAfter: expect.any(Number),
        tokensBefore: expect.any(Number),
      }),
      expect.objectContaining({
        type: 'usage',
        usage: expect.objectContaining({
          contextTokens: expect.any(Number),
          percentage: expect.any(Number),
        }),
      }),
      { type: 'done' },
    ]);
    const manualCompaction = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'context_compacted' }> => (
      chunk.type === 'context_compacted'
    ));
    expectDefined(manualCompaction);
    expectDefined(manualCompaction.tokensAfter);
    expect(manualCompaction.tokensAfter).toBeLessThan(manualCompaction.tokensBefore ?? 0);
    const manualCompactionUsage = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => (
      chunk.type === 'usage'
    ));
    expectDefined(manualCompactionUsage);
    expect(manualCompactionUsage.usage.contextTokens).toBeLessThanOrEqual(
      manualCompaction.tokensAfter + (manualCompactionUsage.usage.contextEnvelope?.system.tokens ?? 0),
    );
    expect(manualCompactionUsage.usage.contextEnvelope?.selectedContext.tokens).toBe(0);
    expect(manualCompaction.summary).toContain('The earlier session history was compacted.');
    expect(manualCompaction.checkpoint).toMatchObject({
      continuationSummary: expect.stringContaining('Continue from the compacted session'),
      tokenEstimate: expect.any(Number),
    });
    expect(mockAgentInstances[0].state.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Continue from the compacted session'),
          }),
        ]),
      }),
    ]));
  });

  it('falls back to one full-context sample when Pass 2 is invalid', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    mockCompactionSample
      .mockResolvedValueOnce(defaultCompactionSample)
      .mockResolvedValueOnce('invalid NOTE₂')
      .mockResolvedValueOnce(defaultCompactionSample);

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({
      text: '/compact preserve exact wikilinks',
    }))) {
      chunks.push(chunk);
    }

    expect(mockCompactionSample).toHaveBeenCalledTimes(3);
    expect((mockCompactionSample.mock.calls[0] as unknown[])[2])
      .not.toContain('preserve exact wikilinks');
    expect((mockCompactionSample.mock.calls[1] as unknown[])[2])
      .toContain('preserve exact wikilinks');
    expect((mockCompactionSample.mock.calls[2] as unknown[])[2])
      .toContain('single-pass fallback');
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'context_compacted' }));
  });

  it('runs manual compaction with instructions after an in-flight threshold compaction', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
    };
    const deps = internals.compactionDeps();
    let resolvePass1: ((value: string) => void) | undefined;
    mockCompactionSample
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolvePass1 = resolve;
      }))
      .mockResolvedValue(defaultCompactionSample);

    const thresholdCompaction = compactCurrentSession(deps, 'threshold');
    await Promise.resolve();
    expect(mockCompactionSample).toHaveBeenCalledTimes(1);

    const manualCompaction = compactCurrentSession(
      deps,
      'manual',
      'preserve wikilinks',
    );
    deps.compactionState.foregroundController?.abort();
    resolvePass1?.(defaultCompactionSample);

    const [, manualResult] = await Promise.all([
      thresholdCompaction.catch(() => null),
      manualCompaction,
    ]);

    expect(manualResult).not.toBeNull();
    const instructionPass2 = mockCompactionSample.mock.calls.find((call) => (
      String((call as unknown[])[2]).includes('preserve wikilinks')
    ));
    expect(instructionPass2).toBeDefined();
    expect(String((instructionPass2 as unknown[])[2])).toContain('Create the final NOTE₂');
  });

  it('recompacts the successful threshold note with waiting manual instructions', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
      sessionTree: SessionTreeStore;
    };
    const deps = internals.compactionDeps();
    let resolvePass1: ((value: string) => void) | undefined;
    mockCompactionSample
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolvePass1 = resolve;
      }))
      .mockResolvedValue(defaultCompactionSample);

    const thresholdCompaction = compactCurrentSession(deps, 'threshold');
    await Promise.resolve();
    const manualCompaction = compactCurrentSession(
      deps,
      'manual',
      'preserve successful-lock instructions',
    );
    resolvePass1?.(defaultCompactionSample);

    const [thresholdResult, manualResult] = await Promise.all([
      thresholdCompaction,
      manualCompaction,
    ]);

    expect(thresholdResult).not.toBeNull();
    expect(manualResult).not.toBeNull();
    expect(mockCompactionSample).toHaveBeenCalledTimes(3);
    expect(String((mockCompactionSample.mock.calls[2] as unknown[])[2]))
      .toContain('preserve successful-lock instructions');
    expect(internals.sessionTree.getEntries().filter(
      entry => entry.type === 'compaction',
    )).toHaveLength(2);
  });

  it('does not retry a waiting manual compaction after lifecycle invalidation', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
    };
    const deps = internals.compactionDeps();
    let resolvePass1: ((value: string) => void) | undefined;
    mockCompactionSample
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolvePass1 = resolve;
      }))
      .mockResolvedValue(defaultCompactionSample);

    const thresholdCompaction = compactCurrentSession(deps, 'threshold');
    await Promise.resolve();
    const manualCompaction = compactCurrentSession(deps, 'manual', 'stale instructions');
    deps.compactionState.generation += 1;
    deps.compactionState.foregroundController?.abort();
    resolvePass1?.(defaultCompactionSample);

    await expect(thresholdCompaction).rejects.toThrow(
      'Session or model changed while context compaction was running.',
    );
    await expect(manualCompaction).rejects.toThrow(
      'Session or model changed while context compaction was waiting for the active run.',
    );
    expect(mockCompactionSample.mock.calls.some(
      call => String((call as unknown[])[2]).includes('stale instructions'),
    )).toBe(false);
  });

  it('serializes foreground compaction for two tabs sharing one session store', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
      sessionTree: SessionTreeStore;
    };
    const firstDeps = internals.compactionDeps();
    const secondDeps = {
      ...firstDeps,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoFingerprint: null,
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
    };

    const [first, second] = await Promise.all([
      compactCurrentSession(firstDeps, 'manual'),
      compactCurrentSession(secondDeps, 'manual'),
    ]);

    expect(first).toEqual(second);
    expect(mockCompactionSample).toHaveBeenCalledTimes(2);
    expect(internals.sessionTree.getEntries().filter(
      (entry) => entry.type === 'compaction',
    )).toHaveLength(1);
  });

  it('discards a sampled compaction when another tab appends to the shared session', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
      sessionTree: SessionTreeStore;
    };
    let resolvePass1: ((value: string) => void) | undefined;
    mockCompactionSample
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolvePass1 = resolve;
      }))
      .mockResolvedValue(defaultCompactionSample);

    const compaction = compactCurrentSession(
      internals.compactionDeps(),
      'manual',
    );
    await Promise.resolve();
    expect(mockCompactionSample).toHaveBeenCalledTimes(1);

    const concurrentUserId = internals.sessionTree.appendUserMessage('Concurrent tab turn');
    internals.sessionTree.appendMessageUi({
      targetEntryId: concurrentUserId,
      displayContent: 'Concurrent tab turn',
      turnRequest: { text: 'Concurrent tab turn' },
    });
    resolvePass1?.(defaultCompactionSample);

    await expect(compaction).rejects.toThrow(
      'Session or model changed while context compaction was running.',
    );
    expect(internals.sessionTree.getEntries().filter(
      (entry) => entry.type === 'compaction',
    )).toHaveLength(0);
    expect(internals.sessionTree.loadAgentMessages()).toContainEqual(
      expect.objectContaining({ role: 'user', content: 'Concurrent tab turn' }),
    );
  });

  it('does not suppress automatic retry when the model changes during sampling', async () => {
    const runtime = createRuntime(createMockPlugin());
    for (const text of ['First turn', 'Second turn']) {
      for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
        // Persist two complete turns (four message entries).
      }
    }
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof compactCurrentSession>[0];
    };
    const deps = internals.compactionDeps();
    const initialModel = deps.resolveModel();
    if (!initialModel) {
      throw new Error('Expected an active model');
    }
    let selectedModel = initialModel;
    deps.resolveModel = () => selectedModel;
    let resolvePass1: ((value: string) => void) | undefined;
    mockCompactionSample
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolvePass1 = resolve;
      }))
      .mockResolvedValue(defaultCompactionSample);

    const compaction = compactCurrentSession(deps, 'threshold');
    await Promise.resolve();
    selectedModel = {
      ...initialModel,
      id: `${initialModel.id}-changed`,
    };
    resolvePass1?.(defaultCompactionSample);

    await expect(compaction).rejects.toThrow(
      'Session or model changed while context compaction was running.',
    );
    expect(deps.compactionState.failedAutoFingerprint).toBeNull();
  });

  it('does not append compaction when all bounded fallback attempts fail', async () => {
    jest.useFakeTimers();
    try {
      const runtime = createRuntime(createMockPlugin());
      for (const text of ['First turn', 'Second turn']) {
        for await (const _chunk of runtime.query(runtime.prepareTurn({ text }))) {
          // Persist two complete turns (four message entries).
        }
      }
      const internals = runtime as unknown as {
        compactionDeps(): Parameters<typeof compactCurrentSession>[0];
        sessionTree: SessionTreeStore;
      };
      mockCompactionSample.mockResolvedValue('invalid checkpoint');

      const compaction = compactCurrentSession(
        internals.compactionDeps(),
        'manual',
      );
      let rejection: unknown;
      const handledCompaction = compaction.catch((error: unknown) => {
        rejection = error;
      });
      await jest.runAllTimersAsync();

      await handledCompaction;
      expect(rejection).toEqual(expect.objectContaining({
        message: 'Compaction model returned an invalid checkpoint.',
      }));
      expect(mockCompactionSample).toHaveBeenCalledTimes(4);
      expect(String((mockCompactionSample.mock.calls[3] as unknown[])[2]))
        .toContain('A previous attempt failed validation.');
      expect(internals.sessionTree.getEntries().filter(
        (entry) => entry.type === 'compaction',
      )).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('prefires NOTE₁ once and keeps it valid when only the tail grows', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    PI_AI_MODELS_CACHE.set('lmstudio/prefire-model', {
      ...localModelFixture(true),
      id: 'prefire-model',
      contextWindow: 200_000,
      maxTokens: 16_000,
    });
    const runtime = createRuntime(createMockPlugin({
      model: 'lmstudio/prefire-model',
      visibleModels: ['lmstudio/prefire-model'],
    }));
    await runtime.ensureReady();
    const internals = runtime as unknown as {
      compactionDeps(): Parameters<typeof prepareCompactionPrefire>[0];
      compactionState: { prefire: unknown };
      sessionTree: SessionTreeStore;
    };
    for (let index = 0; index < 2; index++) {
      const text = `Prefire turn ${index}`;
      const userEntryId = internals.sessionTree.appendUserMessage(text);
      internals.sessionTree.appendMessageUi({
        targetEntryId: userEntryId,
        displayContent: text,
        turnRequest: { text },
      });
      internals.sessionTree.syncAgentMessages([
        { role: 'user', content: text, timestamp: index * 2 + 1 },
        { role: 'assistant', content: `Answer ${index}`, timestamp: index * 2 + 2 },
      ] as never[]);
    }
    const usage: UsageInfo = {
      contextTokens: 145_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 145_000,
      percentage: 73,
    };

    prepareCompactionPrefire(internals.compactionDeps(), usage);
    await Promise.resolve();
    expect(mockCompactionSample).toHaveBeenCalledTimes(1);

    internals.sessionTree.appendUserMessage('Appended tail');
    prepareCompactionPrefire(internals.compactionDeps(), usage);
    expect(mockCompactionSample).toHaveBeenCalledTimes(1);

    runtime.cancel();
    expect(internals.compactionState.prefire).toBeNull();
  });

  it('does not recompact compacted-away raw history on a small follow-up turn', async () => {
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
    for await (const _chunk of runtime.query(runtime.prepareTurn({ text: '/compact keep essentials' }))) {
      // Drain manual compaction.
    }
    mockCompactionSample.mockClear();

    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Small follow-up' }))) {
      chunks.push(chunk);
    }

    expect(mockCompactionSample).not.toHaveBeenCalled();
    expect(chunks).not.toContainEqual({ type: 'context_compacting' });
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenLastCalledWith('Small follow-up');
  });

  it('compacts before sending a turn that would exceed the context threshold', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    await runtime.ensureReady();
    const sessionTree = (runtime as unknown as {
      sessionTree: SessionTreeStore;
    }).sessionTree;
    for (let i = 0; i < 2; i++) {
      const content = `Turn ${i} ${'x'.repeat(100_000)}`;
      sessionTree.appendUserMessage(content);
      sessionTree.syncAgentMessages([
        { role: 'user', content, timestamp: i * 2 + 1 },
        { role: 'assistant', content: `Answer ${i}`, timestamp: i * 2 + 2 },
      ] as never[]);
    }
    mockCompactionSample.mockClear();

    const chunks = [];
    const oversizedTurn = `Continue after preflight compaction ${'y'.repeat(500_000)}`;
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: oversizedTurn }))) {
      chunks.push(chunk);
    }

    expect(mockCompactionSample).toHaveBeenCalled();
    expect(mockCompactionSample).toHaveBeenCalledTimes(2);
    expect((mockCompactionSample.mock.calls[0] as unknown[])[2])
      .toContain('Create NOTE₁');
    expect((mockCompactionSample.mock.calls[1] as unknown[])[2])
      .toContain('Create the final NOTE₂');
    expect(chunks.slice(0, 3)).toEqual([
      { type: 'context_compacting' },
      expect.objectContaining({
        type: 'context_compacted',
        tokensAfter: expect.any(Number),
        tokensBefore: expect.any(Number),
      }),
      expect.objectContaining({
        type: 'usage',
        usage: expect.objectContaining({
          contextTokens: expect.any(Number),
          percentage: expect.any(Number),
        }),
      }),
    ]);
    const preflightCompaction = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'context_compacted' }> => (
      chunk.type === 'context_compacted'
    ));
    expectDefined(preflightCompaction);
    expectDefined(preflightCompaction.tokensAfter);
    expect(preflightCompaction.tokensAfter).toBeLessThan(preflightCompaction.tokensBefore ?? 0);
    const preflightUsage = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => (
      chunk.type === 'usage'
    ));
    expectDefined(preflightUsage);
    expect(preflightUsage.usage.contextTokens).toBeLessThanOrEqual(
      preflightCompaction.tokensAfter + (preflightUsage.usage.contextEnvelope?.system.tokens ?? 0),
    );
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenLastCalledWith(oversizedTurn);
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

  it('allows a small first turn when the model output limit spans its context window', async () => {
    process.env.LMSTUDIO_API_KEY = 'local-placeholder';
    PI_AI_MODELS_CACHE.set(
      'lmstudio/preflight-model',
      {
        ...localModelFixture(true),
        contextWindow: 128_000,
        maxTokens: 128_000,
      },
    );
    const plugin = createMockPlugin({
      model: 'lmstudio/preflight-model',
      visibleModels: ['lmstudio/preflight-model'],
    });
    const runtime = createRuntime(plugin);
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Short first turn' }))) {
      chunks.push(chunk);
    }

    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('Short first turn');
    expect(chunks).not.toContainEqual(expect.objectContaining({
      type: 'error',
      content: expect.stringContaining('too large'),
    }));
  });

  it('emits an estimated usage update after tool results before final assistant usage', async () => {
    const plugin = createMockPlugin();
    const runtime = createRuntime(plugin);
    const chunks = [];
    for await (const _chunk of runtime.query(runtime.prepareTurn({
      text: `Earlier context ${'history '.repeat(1_000)}`,
    }))) {
      // Seed a large persisted context that the next streaming estimate must retain.
    }

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
    expect(firstUsageChunk.usage.contextTokens).toBe(
      firstUsageChunk.usage.contextEnvelope?.total.tokens,
    );
    expect(firstUsageChunk.usage.contextTokens).toBeGreaterThan(
      firstUsageChunk.usage.contextEnvelope?.toolAndAgentResults.tokens ?? 0,
    );
    expect(firstUsageChunk.usage.contextEnvelope?.recentConversation.tokens)
      .toBeGreaterThan(1_500);
    expect(firstUsageChunk.usage.inputTokens).toBe(firstUsageChunk.usage.contextTokens);
    expect(firstUsageChunk.usage.contextTokens).not.toBe(300);
    expect(firstUsageChunk.usage.contextTokensIsAuthoritative).toBe(false);
    expect(firstUsageChunk.usage.contextEnvelope?.system.tokens).toBeGreaterThan(0);
    expect(firstUsageChunk.usage.contextEnvelope?.toolAndAgentResults.tokens).toBeGreaterThan(0);
    expect(finalUsageChunk.usage.contextTokens).toBe(300);
    expect(finalUsageChunk.usage.contextTokensIsAuthoritative).toBe(true);
    expect(finalUsageChunk.usage.contextEnvelope?.total).toEqual({
      source: 'authoritative',
      tokens: 300,
    });
  });

  it('does not expose the compaction fallback as a UI context window', () => {
    expect(buildEstimatedUsageInfo([
      { role: 'user', content: 'Unknown model usage', timestamp: Date.now() },
    ], null)).toMatchObject({ contextWindow: 0, percentage: 0 });
    expect(buildUsageInfoFromAgentMessage({
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 300,
        output: 10,
        totalTokens: 310,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    }, null)).toMatchObject({ contextWindow: 0, percentage: 0 });
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
