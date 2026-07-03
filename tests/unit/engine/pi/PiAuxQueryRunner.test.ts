import { Agent } from '@earendil-works/pi-agent-core';

const mockAgentInstances: Array<{
  listeners: Array<(event: unknown) => void>;
  subscribe: jest.Mock;
  prompt: jest.Mock;
  abort: jest.Mock;
  reset: jest.Mock;
  options: { initialState: { systemPrompt: string; model: unknown }; streamFn: unknown };
}> = [];

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
    initialState: { systemPrompt: string; model: unknown };
    streamFn: unknown;
  }) => {
    const listeners: Array<(event: unknown) => void> = [];
    const instance = {
      options,
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
        await promptBehavior(instance, input);
      }),
      abort: jest.fn(),
      reset: jest.fn(),
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

import { PiAuxQueryRunner } from '@pivi/pivi-agent-core/engine/pi/PiAuxQueryRunner';

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
  return {
    systemPrompt: 'You are a helper.',
    ...overrides,
  };
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
  });

  it('accumulates streamed text, invokes onTextChunk with running total, and returns full text', async () => {
    promptBehavior = async (instance) => {
      for (const listener of [...instance.listeners]) {
        listener({
          type: 'message_update',
          message: {},
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Hello',
            partial: {},
          },
        });
        listener({
          type: 'message_update',
          message: {},
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: ' world',
            partial: {},
          },
        });
      }
    };

    const runner = createRunner();
    const chunks: string[] = [];
    const result = await runner.query(
      baseConfig({ onTextChunk: (text) => chunks.push(text) }),
      'summarize this',
    );

    expect(result).toBe('Hello world');
    expect(chunks).toEqual(['Hello', 'Hello world']);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('summarize this');
    expect(mockResolveModel).toHaveBeenCalledWith(undefined);
    expect(mockResolveAuth).toHaveBeenCalledWith(mockModel);
    expect(jest.mocked(Agent).mock.calls[0]![0]!.streamFn).toBe(mockStreamSimple);
  });

  it('throws Cancelled when abort signal is already set before query', async () => {
    const runner = createRunner();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      runner.query(baseConfig({ abortController }), 'prompt'),
    ).rejects.toThrow('Cancelled');

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
    const promptGate = new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });
    let notifyPromptStarted!: () => void;
    const promptStarted = new Promise<void>((resolve) => {
      notifyPromptStarted = resolve;
    });

    promptBehavior = async (instance) => {
      notifyPromptStarted();
      await promptGate;
      for (const listener of [...instance.listeners]) {
        listener({
          type: 'message_update',
          message: {},
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'late',
            partial: {},
          },
        });
      }
    };

    const runner = createRunner();
    const abortController = new AbortController();
    const queryPromise = runner.query(baseConfig({ abortController }), 'wait');

    await promptStarted;
    abortController.abort();
    expect(mockAgentInstances[0].abort).toHaveBeenCalled();

    resolvePrompt();
    await expect(queryPromise).rejects.toThrow('Cancelled');
  });

  it('throws when model resolution fails', async () => {
    mockResolveModel.mockReturnValue(null);
    const runner = createRunner();

    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow(
      'Could not resolve Pi model for auxiliary query.',
    );
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
    expect(mockResolveAuth).not.toHaveBeenCalled();
  });

  it('throws when provider credentials cannot be resolved', async () => {
    mockResolveAuth.mockResolvedValue(undefined);
    const runner = createRunner();

    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow(
      'Credentials not found for provider: anthropic',
    );
    expect(jest.mocked(Agent)).not.toHaveBeenCalled();
  });

  it('surfaces adapter error chunks as query failures', async () => {
    promptBehavior = async (instance) => {
      for (const listener of [...instance.listeners]) {
        listener({
          type: 'message_end',
          message: {
            role: 'assistant',
            errorMessage: 'rate limited',
          },
        });
      }
    };

    const runner = createRunner();

    await expect(runner.query(baseConfig(), 'prompt')).rejects.toThrow('rate limited');
  });

  it('reset aborts and clears the cached agent so the next query constructs a new one', async () => {
    const runner = createRunner();
    await runner.query(baseConfig(), 'first');
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(1);

    const firstInstance = mockAgentInstances[0];
    runner.reset();

    expect(firstInstance.abort).toHaveBeenCalled();
    expect(firstInstance.reset).toHaveBeenCalled();

    await runner.query(baseConfig(), 'second');
    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    expect(mockAgentInstances[1]).not.toBe(firstInstance);
  });

  it('reuses the same agent when system prompt and model key are unchanged', async () => {
    const runner = createRunner();
    const config = baseConfig({ model: 'anthropic/mock-model' });

    await runner.query(config, 'one');
    await runner.query(config, 'two');

    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledTimes(1);
    expect(mockResolveModel).toHaveBeenCalledWith('anthropic/mock-model');
    expect(mockAgentInstances[0].prompt).toHaveBeenNthCalledWith(1, 'one');
    expect(mockAgentInstances[0].prompt).toHaveBeenNthCalledWith(2, 'two');
  });

  it('creates a new agent when system prompt or model key changes', async () => {
    const runner = createRunner();

    await runner.query(baseConfig({ systemPrompt: 'prompt-a' }), 'first');
    const first = mockAgentInstances[0];

    await runner.query(baseConfig({ systemPrompt: 'prompt-b' }), 'second');

    expect(jest.mocked(Agent)).toHaveBeenCalledTimes(2);
    expect(first.abort).toHaveBeenCalled();
    expect(first.reset).toHaveBeenCalled();
    expect(mockAgentInstances[1].options.initialState.systemPrompt).toBe('prompt-b');
  });
});