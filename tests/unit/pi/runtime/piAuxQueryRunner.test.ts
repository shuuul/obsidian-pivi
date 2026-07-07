import { Agent } from '@earendil-works/pi-agent-core';

const mockAgentInstances: Array<{
  listeners: Array<(event: unknown) => void>;
  subscribe: jest.Mock;
  prompt: jest.Mock;
  abort: jest.Mock;
  reset: jest.Mock;
  state: { messages: unknown[] };
  options: { initialState: { systemPrompt: string; model: unknown }; streamFn: unknown };
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; model: unknown };
    streamFn: unknown;
  }) => {
    const listeners: Array<(event: unknown) => void> = [];
    const instance = {
      options,
      state: { messages: [{ role: 'assistant', content: 'background answer' }] },
      listeners,
      subscribe: jest.fn((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      }),
      prompt: jest.fn(async (input: string) => {
        for (const listener of [...instance.listeners]) {
          listener({
            type: 'message_update',
            message: {},
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 0,
              delta: 'wired-response',
              partial: {},
            },
          });
        }
        void input;
      }),
      abort: jest.fn(),
      reset: jest.fn(),
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

const mockResolvePiModel = jest.fn();
const mockResolvePiProviderAuth = jest.fn();
const mockStreamSimple = jest.fn();

jest.mock('@pivi/pivi-agent-core/engine/pi/piModelEnv', () => ({
  resolvePiModel: (...args: unknown[]) => mockResolvePiModel(...args),
  resolvePiProviderAuth: (...args: unknown[]) => mockResolvePiProviderAuth(...args),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/piAiModels', () => ({
  piAiModels: {
    streamSimple: mockStreamSimple,
  },
}));

import { createPiAuxQueryRunner } from '@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner';

const mockModel = { provider: 'anthropic', id: 'mock-model' };

function createHost(): { settings: { model: string } } {
  return { settings: { model: 'anthropic/mock-model' } };
}

async function waitForBackgroundResult(
  runner: ReturnType<typeof createPiAuxQueryRunner>,
  agentId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (runner.loadSubagentFinalResult(agentId)) {
      return;
    }
  }
}

describe('createPiAuxQueryRunner', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    jest.mocked(Agent).mockClear();
    mockResolvePiModel.mockReset();
    mockResolvePiProviderAuth.mockReset();
    mockStreamSimple.mockReset();
    mockResolvePiModel.mockReturnValue(mockModel);
    mockResolvePiProviderAuth.mockResolvedValue({ auth: { apiKey: 'test-key' } });
  });

  it('resolves model and auth through piModelEnv and streams successfully', async () => {
    const host = createHost() as never;
    const runner = createPiAuxQueryRunner(host);

    const result = await runner.query(
      { systemPrompt: 'You are a helper.', model: 'anthropic/mock-model' },
      'title this note',
    );

    expect(result).toBe('wired-response');
    expect(mockResolvePiModel).toHaveBeenCalledWith(host, 'anthropic/mock-model');
    expect(mockResolvePiProviderAuth).toHaveBeenCalledWith(host, mockModel);
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(1);

    const streamFn = jest.mocked(Agent).mock.calls[0]![0]!.streamFn as (
      ...args: [unknown, unknown]
    ) => unknown;
    streamFn('model-arg', 'request-arg');
    expect(mockStreamSimple).toHaveBeenCalledWith('model-arg', 'request-arg');
  });

  it('reuses a completed same-purpose background subagent', async () => {
    const runner = createPiAuxQueryRunner(createHost() as never);

    const first = await runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-1',
      purpose: 'review',
    }, 'first');
    await waitForBackgroundResult(runner, first.agentId);

    const second = await runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-2',
      purpose: 'review',
    }, 'second');
    await waitForBackgroundResult(runner, second.agentId);

    expect(second.agentId).toBe(first.agentId);
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(1);
    expect(mockAgentInstances[0]!.prompt).toHaveBeenNthCalledWith(1, 'first');
    expect(mockAgentInstances[0]!.prompt).toHaveBeenNthCalledWith(2, 'second');
  });

  it('waits for a background subagent final result', async () => {
    const runner = createPiAuxQueryRunner(createHost() as never);

    const launch = await runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-wait',
      purpose: 'review',
    }, 'first');

    await expect(runner.waitForResult(launch.agentId)).resolves.toEqual({
      status: 'completed',
      result: 'background answer',
    });
  });

  it('discards completed subagents with compaction markers instead of reusing them', async () => {
    const runner = createPiAuxQueryRunner(createHost() as never);

    const first = await runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-1',
      purpose: 'review',
    }, 'first');
    await waitForBackgroundResult(runner, first.agentId);
    mockAgentInstances[0]!.state.messages = [{
      role: 'compactionSummary',
      content: 'old context was compacted',
    }];

    const second = await runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-2',
      purpose: 'review',
    }, 'second');
    await waitForBackgroundResult(runner, second.agentId);

    expect(second.agentId).not.toBe(first.agentId);
    expect(mockAgentInstances[0]!.abort).toHaveBeenCalledTimes(1);
    expect(mockAgentInstances[0]!.reset).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
  });

  it('rejects background compact commands instead of letting a subagent compact', async () => {
    const runner = createPiAuxQueryRunner(createHost() as never);

    await expect(runner.spawn({
      systemPrompt: 'Review helper',
      toolCallId: 'call-compact',
      purpose: 'review',
    }, '/compact summarize')).rejects.toThrow('Subagents cannot run context compaction');
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
  });

  it('keeps only the newest reusable background subagents at the configured concurrency', async () => {
    const host = {
      settings: {
        model: 'anthropic/mock-model',
        agentSettings: {
          subagents: { enabled: true, allowBackground: true, maxConcurrentSubagents: 1 },
        },
      },
    };
    const runner = createPiAuxQueryRunner(host as never);

    const first = await runner.spawn({
      systemPrompt: 'First helper',
      toolCallId: 'call-1',
      purpose: 'first',
    }, 'first');
    await waitForBackgroundResult(runner, first.agentId);

    const second = await runner.spawn({
      systemPrompt: 'Second helper',
      toolCallId: 'call-2',
      purpose: 'second',
    }, 'second');
    await waitForBackgroundResult(runner, second.agentId);

    runner.cleanupIdleSubagents();

    expect(second.agentId).not.toBe(first.agentId);
    const abortCount = mockAgentInstances
      .reduce((total, instance) => total + instance.abort.mock.calls.length, 0);
    expect(abortCount).toBe(1);
  });
});
