import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentTool,
} from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { PiAgentEventAdapter } from '@pivi/engine-pi/piAgentEventAdapter';
import type { PiResolvedModel } from '@pivi/engine-pi/piModelRegistry';
import type { PiRuntimeHost } from '@pivi/engine-pi/piRuntimeHost';
import type { StreamChunk } from '@pivi/agent/runtime';
import type { PreparedChatTurn } from '@pivi/agent/runtime/types';

import { createActiveTurn } from '../../../../packages/engine-pi/src/runtime/piChatRuntimeActiveTurn';
import {
  getAutoCompactionRecoveryWarning,
  type PiChatCompactionDeps,
} from '../../../../packages/engine-pi/src/runtime/piChatRuntimeCompaction';
import { streamPiChatTurn } from '../../../../packages/engine-pi/src/runtime/piChatRuntimeTurn';

function assistant(
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: stopReason === 'stop' ? [{ type: 'text', text: 'Recovered' }] : [],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.3-codex-spark',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function model(): PiResolvedModel {
  return {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    provider: 'openai-codex',
    api: 'openai-codex-responses',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200_000,
    maxTokens: 8_192,
  };
}

function createRetryingAgent() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const state = {
    messages: [] as AgentMessage[],
    model: model(),
    systemPrompt: '',
    tools: [],
    thinkingLevel: 'medium' as const,
  };
  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const failed = assistant('error', 'socket hang up');
  failed.content = [{ type: 'text', text: 'Partial answer' }];
  const recovered = assistant('stop');
  const user: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    timestamp: Date.now(),
  };
  const prompt = jest.fn(async () => {
    state.messages = [user, failed];
    emit({ type: 'message_end', message: user });
    emit({ type: 'message_start', message: failed });
    emit({
      type: 'message_update',
      message: failed,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Partial answer',
        partial: failed,
      },
    });
    emit({
      type: 'message_update',
      message: failed,
      assistantMessageEvent: {
        type: 'error',
        reason: 'error',
        error: failed,
      },
    });
    emit({ type: 'message_end', message: failed });
    emit({ type: 'agent_end', messages: [...state.messages] });
  });
  const continuePrompt = jest.fn(async () => {
    state.messages = [...state.messages, recovered];
    emit({ type: 'message_start', message: recovered });
    emit({
      type: 'message_update',
      message: recovered,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Recovered',
        partial: recovered,
      },
    });
    emit({ type: 'message_end', message: recovered });
    emit({ type: 'agent_end', messages: [...state.messages] });
  });
  const agent = {
    state,
    prompt,
    continue: continuePrompt,
    subscribe: (listener: (event: AgentEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as Agent;
  return { agent, continuePrompt };
}

describe('streamPiChatTurn retry lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the host-localized manual recovery warning only after two automatic failures', () => {
    const warning = 'Localized /compact recovery warning';
    const compaction = {
      plugin: { getCompactionRecoveryWarning: () => warning } as PiRuntimeHost,
      sessionTree: null,
      compactionState: { failedAutoAttempts: new Map<string, number>() },
    } as PiChatCompactionDeps;

    compaction.compactionState.failedAutoAttempts.set('', 1);
    expect(getAutoCompactionRecoveryWarning(compaction)).toBeNull();
    compaction.compactionState.failedAutoAttempts.set('', 2);
    expect(getAutoCompactionRecoveryWarning(compaction)).toBe(warning);
  });

  it('discards a transient failure from persistence before retrying', async () => {
    const { agent, continuePrompt } = createRetryingAgent();
    const activeTurn = createActiveTurn();
    const synced: AgentMessage[][] = [];
    const resolvedModel = model();
    const compaction: PiChatCompactionDeps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => resolvedModel,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const turn = {
      request: { text: 'Hello', images: [] },
      prompt: 'Hello',
      persistedContent: 'Hello',
      displayContent: 'Hello',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    const chunksPromise = (async (): Promise<StreamChunk[]> => {
      const chunks: StreamChunk[] = [];
      for await (const chunk of streamPiChatTurn({
        activeTurn,
        agent,
        compaction,
        eventAdapter: new PiAgentEventAdapter(),
        sessionTree: null,
        resolveModel: () => resolvedModel,
        resolveThinkingLevel: () => 'medium',
        authorizeAndSyncAgentModelSelection: jest.fn(async model => model),
        refreshModelMetadata: async () => false,
        syncSessionMessages: messages => synced.push([...messages]),
        onUserMessagePersisted: jest.fn(),
      }, turn)) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await jest.advanceTimersByTimeAsync(2_000);
    const chunks = await chunksPromise;

    expect(continuePrompt).toHaveBeenCalledTimes(1);
    expect(chunks.map(chunk => chunk.type)).toEqual(expect.arrayContaining([
      'retry_start',
      'retry_end',
      'text',
      'done',
    ]));
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(synced).toHaveLength(1);
    expect(synced[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stopReason: 'error' }),
    ]));
    expect(synced[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ stopReason: 'stop' }),
    ]));
  });

  it('persists partial thinking and text when a total deadline is terminal', async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const failed = assistant('error', 'Total deadline exceeded (30000ms)');
    failed.content = [
      { type: 'thinking', thinking: 'Partial reasoning' },
      { type: 'text', text: 'Partial answer' },
    ];
    const state = {
      messages: [] as AgentMessage[],
      model: model(),
      systemPrompt: '',
      tools: [],
      thinkingLevel: 'medium' as const,
    };
    const agent = {
      state,
      prompt: jest.fn(async () => {
        state.messages = [failed];
        for (const listener of listeners) {
          listener({ type: 'message_end', message: failed });
          listener({ type: 'agent_end', messages: [failed] });
        }
      }),
      continue: jest.fn(),
      subscribe: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Agent;
    const activeTurn = createActiveTurn();
    const resolvedModel = model();
    const synced: AgentMessage[][] = [];
    const compaction: PiChatCompactionDeps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => resolvedModel,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const turn = {
      request: { text: 'Think for a long time', images: [] },
      prompt: 'Think for a long time',
      persistedContent: 'Think for a long time',
      displayContent: 'Think for a long time',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    for await (const _chunk of streamPiChatTurn({
      activeTurn,
      agent,
      compaction,
      eventAdapter: new PiAgentEventAdapter(),
      sessionTree: null,
      resolveModel: () => resolvedModel,
      resolveThinkingLevel: () => 'medium',
      authorizeAndSyncAgentModelSelection: async nextModel => nextModel,
      refreshModelMetadata: async () => false,
      syncSessionMessages: messages => synced.push([...messages]),
      onUserMessagePersisted: jest.fn(),
    }, turn)) {
      // Drain the terminal turn.
    }

    expect(agent.continue).not.toHaveBeenCalled();
    expect(synced.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stopReason: 'error',
        content: [
          { type: 'thinking', thinking: 'Partial reasoning' },
          { type: 'text', text: 'Partial answer' },
        ],
      }),
    ]));
  });

  it('applies a model switch to the next request inside the active agent loop', async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const originalModel = model();
    const selectedModel: PiResolvedModel = {
      ...originalModel,
      id: 'gpt-5.4-codex',
      name: 'GPT-5.4 Codex',
      contextWindow: 400_000,
    };
    let resolvedModel = originalModel;
    let nextTurnUpdate: Awaited<ReturnType<NonNullable<Agent['prepareNextTurnWithContext']>>>;
    const state = {
      messages: [] as AgentMessage[],
      model: originalModel,
      systemPrompt: '',
      tools: [],
      thinkingLevel: 'medium' as const,
    };
    const completed = assistant('stop');
    const agent = {
      state,
      prompt: jest.fn(async () => {
        resolvedModel = selectedModel;
        nextTurnUpdate = await agent.prepareNextTurnWithContext?.({
          context: { messages: [completed], systemPrompt: '', tools: [] },
          message: completed,
          newMessages: [completed],
          toolResults: [{} as never],
        });
        state.messages = [completed];
        for (const listener of listeners) {
          listener({ type: 'message_end', message: completed });
          listener({ type: 'agent_end', messages: [completed] });
        }
      }),
      continue: jest.fn(),
      subscribe: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prepareNextTurnWithContext: undefined,
    } as unknown as Agent;
    const activeTurn = createActiveTurn();
    const compaction: PiChatCompactionDeps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => resolvedModel,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const authorizeAndSyncAgentModelSelection = jest.fn(async (nextModel: PiResolvedModel) => {
      state.model = nextModel;
      return nextModel;
    });
    const turn = {
      request: { text: 'Hello', images: [] },
      prompt: 'Hello',
      persistedContent: 'Hello',
      displayContent: 'Hello',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    for await (const _chunk of streamPiChatTurn({
      activeTurn,
      agent,
      compaction,
      eventAdapter: new PiAgentEventAdapter(),
      sessionTree: null,
      resolveModel: () => resolvedModel,
      resolveThinkingLevel: () => 'high',
      authorizeAndSyncAgentModelSelection,
      refreshModelMetadata: async () => false,
      syncSessionMessages: jest.fn(),
      onUserMessagePersisted: jest.fn(),
    }, turn)) {
      // Drain the turn so the prompt lifecycle completes.
    }

    expect(authorizeAndSyncAgentModelSelection).toHaveBeenCalledWith(selectedModel);
    expect(nextTurnUpdate).toMatchObject({
      model: selectedModel,
      thinkingLevel: 'high',
    });
    expect(state.model).toBe(selectedModel);
  });

  it('overlays live tools and system prompt onto the next tool-result continuation', async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const originalTools = [{ name: 'legacy_tool' }] as unknown as AgentTool[];
    const refreshedTools = [
      { name: 'pivi_mcp' },
      { name: 'pivi_skills' },
    ] as unknown as AgentTool[];
    const stalePrompt = 'stale system prompt';
    const livePrompt = 'refreshed system prompt after management commit';
    const state = {
      messages: [] as AgentMessage[],
      model: model(),
      systemPrompt: stalePrompt,
      tools: originalTools as unknown[],
      thinkingLevel: 'medium' as const,
    };
    const toolAssistant = {
      ...assistant('stop'),
      content: [{ type: 'toolCall', id: 'call-mgmt', name: 'pivi_mcp', arguments: {} }],
    } as AssistantMessage;
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'call-mgmt',
      toolName: 'pivi_mcp',
      content: [{ type: 'text', text: 'saved' }],
      isError: false,
    } as AgentMessage;
    let nextTurnUpdate: Awaited<ReturnType<NonNullable<Agent['prepareNextTurnWithContext']>>>;
    const agent = {
      state,
      prompt: jest.fn(async () => {
        // Simulate a management tool hot-sync during the tool call.
        state.systemPrompt = livePrompt;
        state.tools = refreshedTools;
        nextTurnUpdate = await agent.prepareNextTurnWithContext?.({
          context: {
            messages: [toolAssistant, toolResult],
            systemPrompt: stalePrompt,
            tools: originalTools,
          },
          message: toolAssistant,
          newMessages: [toolAssistant, toolResult],
          toolResults: [toolResult as never],
        });
        state.messages = [toolAssistant, toolResult, assistant('stop')];
        for (const listener of listeners) {
          listener({ type: 'message_end', message: toolAssistant });
          listener({ type: 'message_end', message: toolResult });
          listener({ type: 'message_end', message: assistant('stop') });
          listener({ type: 'agent_end', messages: state.messages });
        }
      }),
      continue: jest.fn(),
      subscribe: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prepareNextTurnWithContext: undefined,
    } as unknown as Agent;
    const activeTurn = createActiveTurn();
    const compaction: PiChatCompactionDeps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => state.model,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const turn = {
      request: { text: 'Manage MCP', images: [] },
      prompt: 'Manage MCP',
      persistedContent: 'Manage MCP',
      displayContent: 'Manage MCP',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    for await (const _chunk of streamPiChatTurn({
      activeTurn,
      agent,
      compaction,
      eventAdapter: new PiAgentEventAdapter(),
      sessionTree: null,
      resolveModel: () => state.model,
      resolveThinkingLevel: () => 'medium',
      authorizeAndSyncAgentModelSelection: async (nextModel) => nextModel,
      refreshModelMetadata: async () => false,
      syncSessionMessages: jest.fn(),
      onUserMessagePersisted: jest.fn(),
    }, turn)) {
      // Drain.
    }

    expect(nextTurnUpdate).toMatchObject({
      context: {
        systemPrompt: livePrompt,
        tools: refreshedTools,
        messages: [toolAssistant, toolResult],
      },
    });
    // Sibling tool execution already emitted keeps the original registry; only
    // the next continuation context is overlaid.
    expect(nextTurnUpdate?.context?.messages).toBeDefined();
  });

  it.each(['metadata refresh', 'tool continuation'] as const)('omits duplicate output tokens from the %s usage push', async (refreshKind) => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const resolvedModel = model();
    const completed = assistant('stop');
    completed.usage = {
      input: 120,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    };
    const user: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: Date.now(),
    };
    const continuation = assistant('stop');
    continuation.usage = { ...completed.usage, output: 25, totalTokens: 145 };
    const toolResult: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'search',
      content: [{ type: 'text', text: 'Found a note' }],
      isError: false,
      timestamp: Date.now(),
    };
    if (refreshKind === 'tool continuation') {
      completed.stopReason = 'toolUse';
      completed.content = [{ type: 'toolCall', id: 'call-1', name: 'search', arguments: {} }];
    }
    const state = {
      messages: [] as AgentMessage[],
      model: resolvedModel,
      systemPrompt: '',
      tools: [],
      thinkingLevel: 'medium' as const,
    };
    const agent = {
      state,
      prompt: jest.fn(async () => {
        state.messages = [user, completed];
        for (const listener of listeners) {
          listener({ type: 'message_end', message: user });
          listener({ type: 'message_end', message: completed });
        }
        if (refreshKind === 'tool continuation') {
          state.messages.push(toolResult);
          for (const listener of listeners) {
            listener({ type: 'message_end', message: toolResult });
          }
          await agent.prepareNextTurnWithContext?.({
            context: { messages: [...state.messages], systemPrompt: '', tools: [] },
            message: completed,
            newMessages: [completed, toolResult],
            toolResults: [toolResult],
          });
          state.messages.push(continuation);
          for (const listener of listeners) {
            listener({ type: 'message_end', message: continuation });
          }
        }
        for (const listener of listeners) {
          listener({ type: 'agent_end', messages: [...state.messages] });
        }
      }),
      continue: jest.fn(),
      subscribe: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Agent;
    const activeTurn = createActiveTurn();
    const compaction: PiChatCompactionDeps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => resolvedModel,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const turn = {
      request: { text: 'Hello', images: [] },
      prompt: 'Hello',
      persistedContent: 'Hello',
      displayContent: 'Hello',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    const chunks: StreamChunk[] = [];
    for await (const chunk of streamPiChatTurn({
      activeTurn,
      agent,
      compaction,
      eventAdapter: new PiAgentEventAdapter(),
      sessionTree: null,
      resolveModel: () => resolvedModel,
      resolveThinkingLevel: () => 'medium',
      authorizeAndSyncAgentModelSelection: jest.fn(async nextModel => nextModel),
      refreshModelMetadata: async () => refreshKind === 'metadata refresh',
      syncSessionMessages: jest.fn(),
      onUserMessagePersisted: jest.fn(),
    }, turn)) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage',
    );
    expect(usageChunks).toHaveLength(refreshKind === 'tool continuation' ? 4 : 2);
    // message_end carries the authoritative usage, including output tokens.
    expect(usageChunks[0]?.usage.outputTokens).toBe(40);
    // Pressure/metadata updates must not add to the UI generation clock.
    expect(usageChunks[1]?.usage.outputTokens).toBeUndefined();
    expect(usageChunks[1]?.usage.contextTokens).toBeGreaterThanOrEqual(120);
    const refreshUsage = usageChunks[refreshKind === 'tool continuation' ? 2 : 1]?.usage;
    expect(refreshUsage).not.toHaveProperty('outputTokens');
    expect(refreshUsage?.contextTokens).toBeGreaterThanOrEqual(120);
    expect(usageChunks.map(chunk => chunk.usage.outputTokens)).toEqual(
      refreshKind === 'tool continuation' ? [40, undefined, undefined, 25] : [40, undefined],
    );
    expect(usageChunks.reduce((sum, chunk) => sum + (chunk.usage.outputTokens ?? 0), 0))
      .toBe(refreshKind === 'tool continuation' ? 65 : 40);
  });

  it('blocks the next provider request when a trailing tool result overflows the window', async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const resolvedModel: PiResolvedModel = {
      ...model(),
      id: 'qwen3.8-flash-next',
      name: 'qwen3.8-flash-next',
      provider: 'custom-openai-compatible-5bbe1d19934e',
      api: 'openai-completions',
      contextWindow: 262_144,
      contextWindowIsAuthoritative: true,
      maxTokens: 65_536,
    };
    const toolAssistant = {
      ...assistant('toolUse'),
      provider: resolvedModel.provider,
      model: resolvedModel.id,
      api: resolvedModel.api,
      content: [{ type: 'toolCall', id: 'search-1', name: 'search', arguments: { query: 'nerve' } }],
      usage: {
        input: 70_963,
        output: 440,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 71_403,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    } as AssistantMessage;
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'search-1',
      toolName: 'search',
      content: [{ type: 'text', text: 'x'.repeat(1_340_014) }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage;
    const persisted = [
      { role: 'user', content: [{ type: 'text', text: 'search transcripts' }], timestamp: Date.now() } as AgentMessage,
      toolAssistant,
    ];
    const entries = persisted.map((message, index) => ({
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp: new Date(index).toISOString(),
      type: 'message' as const,
      message,
    }));
    const sessionTree = {
      getLeafId: () => 'leaf-1',
      getLinearLlmContextEntries: () => entries,
      getActiveLlmContextEntries: () => entries,
      loadAgentMessages: () => persisted,
      getSessionId: () => 'session-1',
      getVaultRelativeSessionFile: () => '.pivi/sessions/overflow.jsonl',
      appendUserMessage: jest.fn(() => 'user-1'),
      appendMessageUi: jest.fn(),
    };
    const state = {
      messages: persisted,
      model: resolvedModel,
      systemPrompt: 'prompt',
      tools: [],
      thinkingLevel: 'medium' as const,
    };
    const agent = {
      state,
      prompt: jest.fn(async () => {
        await agent.prepareNextTurnWithContext?.({
          context: {
            messages: [...persisted, toolResult],
            systemPrompt: 'prompt',
            tools: [],
          },
          message: toolAssistant,
          newMessages: [...persisted, toolResult],
          toolResults: [toolResult as never],
        });
        throw new Error('provider continuation must not run');
      }),
      continue: jest.fn(),
      subscribe: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prepareNextTurnWithContext: undefined,
    } as unknown as Agent;
    const activeTurn = createActiveTurn();
    const compaction: PiChatCompactionDeps = {
      plugin: {
        getContinuationBlockedWarning: () => 'blocked-continuation',
      } as PiRuntimeHost,
      sessionTree: sessionTree as never,
      agent,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => resolvedModel,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    };
    const turn = {
      request: { text: 'search transcripts', images: [] },
      prompt: 'search transcripts',
      persistedContent: 'search transcripts',
      displayContent: 'search transcripts',
      isCompact: false,
      mcpMentions: new Set<string>(),
    } satisfies PreparedChatTurn;

    const chunks: StreamChunk[] = [];
    for await (const chunk of streamPiChatTurn({
      activeTurn,
      agent,
      compaction,
      eventAdapter: new PiAgentEventAdapter(),
      sessionTree: sessionTree as never,
      resolveModel: () => resolvedModel,
      resolveThinkingLevel: () => 'medium',
      authorizeAndSyncAgentModelSelection: async nextModel => nextModel,
      refreshModelMetadata: async () => false,
      syncSessionMessages: jest.fn(),
      onUserMessagePersisted: jest.fn(),
    }, turn)) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage',
    );
    const lastUsage = usageChunks.at(-1)?.usage;
    expect(lastUsage?.contextTokens).toBeGreaterThan(71_403);
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'notice', content: 'blocked-continuation' }),
    ]));
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(false);
    expect(agent.continue).not.toHaveBeenCalled();
  });
});
