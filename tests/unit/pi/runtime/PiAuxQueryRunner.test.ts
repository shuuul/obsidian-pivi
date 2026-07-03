import { Agent } from '@earendil-works/pi-agent-core';

const mockAgentInstances: Array<{
  listeners: Array<(event: unknown) => void>;
  subscribe: jest.Mock;
  prompt: jest.Mock;
  abort: jest.Mock;
  reset: jest.Mock;
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

jest.mock('@pivi/pivi-agent-core/engine/pi/PiModelEnv', () => ({
  resolvePiModel: (...args: unknown[]) => mockResolvePiModel(...args),
  resolvePiProviderAuth: (...args: unknown[]) => mockResolvePiProviderAuth(...args),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/PiAiModels', () => ({
  piAiModels: {
    streamSimple: mockStreamSimple,
  },
}));

import { createPiAuxQueryRunner } from '@pivi/pivi-agent-core/engine/pi/PiAuxQueryRunner';

const mockModel = { provider: 'anthropic', id: 'mock-model' };

function createHost(): { settings: { model: string } } {
  return { settings: { model: 'anthropic/mock-model' } };
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
});