import { Agent } from '@earendil-works/pi-agent-core';

const mockAgentInstances: Array<{
  listeners: Array<(event: unknown) => void>;
  subscribe: jest.Mock;
  prompt: jest.Mock;
  abort: jest.Mock;
  reset: jest.Mock;
  state: { messages: unknown[] };
  options: { initialState: { systemPrompt: string; model: unknown; messages?: unknown[] }; streamFn: unknown };
}> = [];

function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}

let promptBehavior: (instance: (typeof mockAgentInstances)[number], input: string) => Promise<void> =
  async (instance) => {
    for (const listener of [...instance.listeners]) {
      listener({
        type: 'message_update',
        message: {},
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'aux-response',
          partial: {},
        },
      });
    }
  };

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; model: unknown; messages?: unknown[] };
    streamFn: unknown;
  }) => {
    const listeners: Array<(event: unknown) => void> = [];
    const instance: (typeof mockAgentInstances)[number] = {
      options,
      state: { messages: [...(options.initialState.messages ?? [])] },
      listeners,
      subscribe: jest.fn((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      }),
      prompt: jest.fn(async (input: string) => {
        await promptBehavior(instance, input);
      }),
      abort: jest.fn(),
      reset: jest.fn(),
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

import { PiAuxQueryRunner } from '@pivi/engine-pi/piAuxQueryRunner';

const mockModel = { provider: 'anthropic', id: 'mock-model' };
const mockResolveModel = jest.fn();
const mockResolveAuth = jest.fn();
const mockStreamSimple = jest.fn();

function createRunner(): PiAuxQueryRunner {
  return new PiAuxQueryRunner({
    resolveModel: (modelKey) => mockResolveModel(modelKey),
    resolveAuth: (model) => mockResolveAuth(model),
    streamSimple: mockStreamSimple,
  });
}

function baseConfig(overrides: Partial<{
  systemPrompt: string;
  model: string;
  abortController: AbortController;
  onTextChunk: (text: string) => void;
}> = {}) {
  return { systemPrompt: 'You are a helper.', ...overrides };
}

describe('PiAuxQueryRunner (core)', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    jest.mocked(Agent).mockClear();
    mockResolveModel.mockReset();
    mockResolveAuth.mockReset();
    mockStreamSimple.mockReset();
    mockResolveModel.mockReturnValue(mockModel);
    mockResolveAuth.mockResolvedValue({ auth: { apiKey: 'test-key' } });
    promptBehavior = async (instance) => {
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'aux-response', partial: {} } });
      }
    };
  });

  it('accumulates streamed text, invokes onTextChunk with running total, and returns full text', async () => {
    promptBehavior = async (instance) => {
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} } });
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world', partial: {} } });
      }
    };
    const runner = createRunner();
    const chunks: string[] = [];
    const result = await runner.query(baseConfig({ onTextChunk: (text) => chunks.push(text) }), 'summarize this');
    expect(result).toBe('Hello world');
    expect(chunks).toEqual(['Hello', 'Hello world']);
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('summarize this');
    expect(mockResolveModel).toHaveBeenCalledWith(undefined);
    expect(mockResolveAuth).toHaveBeenCalledWith(mockModel);
    const agentCall = jest.mocked(Agent).mock.calls[0];
    expectDefined(agentCall);
    const agentOptions = agentCall[0];
    expectDefined(agentOptions);
    expect(typeof agentOptions.streamFn).toBe('function');
    expect(agentOptions.streamFn).not.toBe(mockStreamSimple);
    (agentOptions.streamFn as (model: unknown, context: unknown) => unknown)('model-arg', 'request-arg');
    expect(mockStreamSimple).toHaveBeenCalledWith('model-arg', 'request-arg', undefined);
  });

  it('builds read headroom from the child model instead of a parent session', async () => {
    let resolveChildReadMaxChars: ((requestedMaxChars?: number) => { maxChars: number; settle: (returnedChars: number) => void }) | undefined;
    mockResolveModel.mockReturnValue({ ...mockModel, contextWindow: 20_000, maxTokens: 4_000 });
    const runner = new PiAuxQueryRunner({
      resolveModel: (modelKey) => mockResolveModel(modelKey),
      resolveAuth: (model) => mockResolveAuth(model),
      streamSimple: mockStreamSimple,
      getTools: (resolveReadMaxChars) => {
        resolveChildReadMaxChars = resolveReadMaxChars;
        return [];
      },
    });
    await runner.query(baseConfig(), 'prompt');
    expect(resolveChildReadMaxChars?.().maxChars).toBe(500_000);
  });

  it('throws Cancelled when abort signal is already set before query', async () => {
    const runner = createRunner();
    const abortController = new AbortController();
    abortController.abort();
    await expect(runner.query(baseConfig({ abortController }), 'prompt')).rejects.toThrow('Cancelled');
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
    expect(mockResolveModel).not.toHaveBeenCalled();
  });

  it('throws Cancelled when abort signal is set after prompt completes', async () => {
    const runner = createRunner();
    const abortController = new AbortController();
    const queryPromise = runner.query(baseConfig({ abortController }), 'prompt');
    abortController.abort();
    await expect(queryPromise).rejects.toThrow('Cancelled');
  });

  it('aborts the agent when the config abort signal fires during query', async () => {
    let resolvePrompt!: () => void;
    const promptGate = new Promise<void>((resolve) => { resolvePrompt = resolve; });
    let notifyPromptStarted!: () => void;
    const promptStarted = new Promise<void>((resolve) => { notifyPromptStarted = resolve; });
    promptBehavior = async (instance) => {
      notifyPromptStarted();
      await promptGate;
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'late', partial: {} } });
      }
    };
    const runner = createRunner();
    const abortController = new AbortController();
    const queryPromise = runner.query(baseConfig({ abortController }), 'wait');
    await promptStarted;
    abortController.abort();
    expectDefined(mockAgentInstances[0]);
    expect(mockAgentInstances[0].abort).toHaveBeenCalled();
    resolvePrompt();
    await expect(queryPromise).rejects.toThrow('Cancelled');
  });

  it('throws when model resolution fails', async () => {
    mockResolveModel.mockReturnValue(null);
    const runner = createRunner();
    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow('Could not resolve Pi model for auxiliary query.');
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
    expect(mockResolveAuth).not.toHaveBeenCalled();
  });

  it('throws when provider credentials cannot be resolved', async () => {
    mockResolveAuth.mockResolvedValue(undefined);
    const runner = createRunner();
    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow('Credentials not found for provider: anthropic');
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
  });

  it('surfaces adapter error chunks as query failures', async () => {
    promptBehavior = async (instance) => {
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_end', message: { role: 'assistant', errorMessage: 'rate limited' } });
      }
    };
    const runner = createRunner();
    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow('rate limited');
  });

  it('reset aborts an in-flight query agent so the next query constructs a new one', async () => {
    let resolvePrompt!: () => void;
    const promptGate = new Promise<void>((resolve) => { resolvePrompt = resolve; });
    let notifyPromptStarted!: () => void;
    const promptStarted = new Promise<void>((resolve) => { notifyPromptStarted = resolve; });
    promptBehavior = async (instance) => {
      notifyPromptStarted();
      await promptGate;
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'late', partial: {} } });
      }
    };
    const runner = createRunner();
    const queryPromise = runner.query(baseConfig(), 'first');
    await promptStarted;
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(1);
    const firstInstance = mockAgentInstances[0];
    expectDefined(firstInstance);
    runner.reset();
    expect(firstInstance.abort).toHaveBeenCalled();
    expect(firstInstance.reset).toHaveBeenCalled();
    resolvePrompt();
    await queryPromise;
    await runner.query(baseConfig(), 'second');
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    expectDefined(mockAgentInstances[1]);
    expect(mockAgentInstances[1]).not.toBe(firstInstance);
  });

  it('reset survives the real Agent in-flight reset guard and still clears every agent', async () => {
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { resolveFirst = resolve; });
    let notifyFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { notifyFirstStarted = resolve; });
    let notifySecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => { notifySecondStarted = resolve; });
    promptBehavior = async (instance, input) => {
      if (input === 'first') {
        notifyFirstStarted();
        await firstGate;
      } else if (input === 'second') {
        notifySecondStarted();
      }
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: `${input}-late`, partial: {} } });
      }
    };
    const runner = createRunner();
    const firstPromise = runner.query(baseConfig(), 'first');
    await firstStarted;
    const secondPromise = runner.query(baseConfig(), 'second');
    await secondStarted;
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    const first = mockAgentInstances[0];
    const second = mockAgentInstances[1];
    expectDefined(first);
    expectDefined(second);
    // Mirror the pinned Agent: reset() throws while the aborted run settles.
    first.reset.mockImplementation(() => {
      throw new Error('Agent is already processing. Wait for completion before resetting.');
    });
    expect(() => runner.reset()).not.toThrow();
    expect(first.abort).toHaveBeenCalled();
    expect(second.abort).toHaveBeenCalled();
    expect(second.reset).toHaveBeenCalled();
    resolveFirst();
    await Promise.allSettled([firstPromise, secondPromise]);
    await runner.query(baseConfig(), 'third');
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(3);
  });

  it('gives sequential queries with the same config isolated empty histories', async () => {
    promptBehavior = async (instance, input) => {
      instance.state.messages.push({ role: 'user', content: input });
      for (const listener of [...instance.listeners]) {
        listener({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'aux-response', partial: {} } });
      }
    };
    const runner = createRunner();
    const config = baseConfig({ model: 'anthropic/mock-model' });
    await runner.query(config, 'one');
    await runner.query(config, 'two');
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    expect(mockResolveModel).toHaveBeenCalledTimes(2);
    expect(mockResolveModel).toHaveBeenCalledWith('anthropic/mock-model');
    const first = mockAgentInstances[0];
    const second = mockAgentInstances[1];
    expectDefined(first);
    expectDefined(second);
    expect(second).not.toBe(first);
    const firstCall = jest.mocked(Agent).mock.calls[0];
    const secondCall = jest.mocked(Agent).mock.calls[1];
    expectDefined(firstCall);
    expectDefined(secondCall);
    const firstOptions = firstCall[0];
    const secondOptions = secondCall[0];
    expectDefined(firstOptions);
    expectDefined(secondOptions);
    expectDefined(firstOptions.initialState);
    expectDefined(secondOptions.initialState);
    expect(firstOptions.initialState.messages).toEqual([]);
    expect(secondOptions.initialState.messages).toEqual([]);
    expect(first.prompt).toHaveBeenCalledTimes(1);
    expect(first.prompt).toHaveBeenCalledWith('one');
    expect(second.prompt).toHaveBeenCalledTimes(1);
    expect(second.prompt).toHaveBeenCalledWith('two');
    expect(second.state.messages).toEqual([{ role: 'user', content: 'two' }]);
    expect(first.abort).not.toHaveBeenCalled();
  });

  it('does not abort an in-flight query when a later query uses a different config', async () => {
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { resolveFirst = resolve; });
    let notifyFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { notifyFirstStarted = resolve; });
    promptBehavior = async (instance, input) => {
      if (input === 'first') {
        notifyFirstStarted();
        await firstGate;
      }
      for (const listener of [...instance.listeners]) {
        listener({
          type: 'message_update',
          message: {},
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: `${input}-done`, partial: {} },
        });
      }
    };
    const runner = createRunner();
    const firstPromise = runner.query(baseConfig({ systemPrompt: 'prompt-a' }), 'first');
    await firstStarted;
    const first = mockAgentInstances[0];
    expectDefined(first);
    let notifySecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => { notifySecondStarted = resolve; });
    const previousPromptBehavior = promptBehavior;
    promptBehavior = async (instance, input) => {
      if (input === 'second') {
        notifySecondStarted();
      }
      await previousPromptBehavior(instance, input);
    };
    const secondPromise = runner.query(baseConfig({ systemPrompt: 'prompt-b' }), 'second');
    await secondStarted;
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    expect(first.abort).not.toHaveBeenCalled();
    const second = mockAgentInstances[1];
    expectDefined(second);
    expect(second).not.toBe(first);
    expect(second.options.initialState.systemPrompt).toBe('prompt-b');
    resolveFirst();
    await expect(firstPromise).resolves.toBe('first-done');
    await expect(secondPromise).resolves.toBe('second-done');
    expect(first.prompt).toHaveBeenCalledTimes(1);
    expect(second.prompt).toHaveBeenCalledTimes(1);
  });
});
