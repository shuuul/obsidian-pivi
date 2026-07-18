import type {
  Agent,
  AgentEvent,
  AgentMessage,
} from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { PiAgentEventAdapter } from '@pivi/pivi-agent-core/engine/pi/piAgentEventAdapter';
import type { PiResolvedModel } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/piRuntimeHost';
import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { PreparedChatTurn } from '@pivi/pivi-agent-core/runtime/types';

import { createActiveTurn } from '../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeActiveTurn';
import type { PiChatCompactionDeps } from '../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeCompaction';
import { streamPiChatTurn } from '../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeTurn';

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

  it('persists a transient failure without projecting it as a terminal error', async () => {
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
        failedAutoFingerprint: null,
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
    expect(synced).toHaveLength(2);
    expect(synced[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ stopReason: 'error', errorMessage: 'socket hang up' }),
    ]));
    expect(synced[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ stopReason: 'error', errorMessage: 'socket hang up' }),
      expect.objectContaining({ stopReason: 'stop' }),
    ]));
  });
});
