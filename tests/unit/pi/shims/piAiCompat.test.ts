import {
  complete,
  completeSimple,
  getApiProvider,
  getModels,
  getProviders,
  registerApiProvider,
  resetApiProviders,
  stream,
  streamSimple,
  unregisterApiProviders,
} from '@pivi/pi-runtime/shims/piAiCompat';

const deepseekEnvName = ['DEEPSEEK', 'API', 'KEY'].join('_');

const mockModel = {
  id: 'mock-model',
  provider: 'deepseek',
  api: 'mock-api',
  name: 'Mock model',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
} as any;

const mockContext = {
  messages: [],
} as any;

function createTestStream(message: unknown = { role: 'assistant', content: [] }): any {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
    result: () => Promise.resolve(message),
  };
}

describe('piAiCompat shim', () => {
  beforeEach(() => {
    resetApiProviders();
    delete process.env[deepseekEnvName];
  });

  it('exposes the same model catalog as the Pivi-supported pi-ai models collection', () => {
    expect(getProviders()).toEqual(['anthropic', 'deepseek', 'google', 'openai-codex', 'opencode-go', 'openrouter']);
    expect(getModels('deepseek')).toEqual([
      expect.objectContaining({ provider: 'deepseek', id: 'mock-model' }),
    ]);
  });

  it('delegates stream and complete calls to the supported pi-ai models collection by default', async () => {
    await expect(completeSimple(mockModel, mockContext)).resolves.toEqual(expect.objectContaining({ role: 'assistant' }));
    await expect(complete(mockModel, mockContext)).resolves.toEqual(expect.objectContaining({ role: 'assistant' }));

    expect(streamSimple(mockModel, mockContext)).toEqual(expect.objectContaining({ result: expect.any(Function) }));
    expect(stream(mockModel, mockContext)).toEqual(expect.objectContaining({ result: expect.any(Function) }));
  });

  it('preserves compat dynamic API provider registration and source-scoped unregister', async () => {
    const firstStream = jest.fn(() => createTestStream({ role: 'assistant', content: ['first'] }));
    const secondStream = jest.fn(() => createTestStream({ role: 'assistant', content: ['second'] }));

    registerApiProvider({ api: 'mock-api' as any, stream: firstStream as any, streamSimple: firstStream as any }, 'first');
    registerApiProvider({ api: 'other-api' as any, stream: secondStream as any, streamSimple: secondStream as any }, 'second');

    expect(getApiProvider('mock-api' as any)).toBeDefined();
    await expect(completeSimple(mockModel, mockContext)).resolves.toEqual({ role: 'assistant', content: ['first'] });

    unregisterApiProviders('first');

    expect(getApiProvider('mock-api' as any)).toBeUndefined();
    expect(getApiProvider('other-api' as any)).toBeDefined();

    unregisterApiProviders();

    expect(getApiProvider('other-api' as any)).toBeUndefined();
  });

  it('injects env API keys only when request options do not already provide one', () => {
    process.env[deepseekEnvName] = 'env-value-for-test';
    const streamSpy = jest.fn(() => createTestStream());
    registerApiProvider({ api: 'mock-api' as any, stream: streamSpy as any, streamSimple: streamSpy as any });

    streamSimple(mockModel, mockContext);
    expect(streamSpy).toHaveBeenLastCalledWith(mockModel, mockContext, { apiKey: 'env-value-for-test' });

    streamSimple(mockModel, mockContext, { apiKey: 'explicit-value-for-test' } as any);
    expect(streamSpy).toHaveBeenLastCalledWith(mockModel, mockContext, { apiKey: 'explicit-value-for-test' });
  });
});
