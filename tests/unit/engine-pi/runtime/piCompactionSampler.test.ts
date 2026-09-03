const mockResolvePiModel = jest.fn();
const mockResolvePiProviderAuth = jest.fn();
const mockStreamSimple = jest.fn();
const mockGetInstalledCustomProviderIds = jest.fn();

jest.mock('@pivi/engine-pi/piModelEnv', () => ({
  resolvePiModel: (...args: unknown[]) => mockResolvePiModel(...args),
  resolvePiProviderAuth: (...args: unknown[]) => mockResolvePiProviderAuth(...args),
}));

jest.mock('@pivi/engine-pi/piAiModels', () => ({
  getInstalledCustomProviderIds: () => mockGetInstalledCustomProviderIds(),
  streamPiAiModelsSimple: (...args: unknown[]) => mockStreamSimple(...args),
}));

import {
  PiCompactionTimeoutError,
  sampleCompactionNote,
} from '../../../../packages/engine-pi/src/runtime/piCompactionSampler';

const mockModel = {
  api: 'openai-completions',
  id: 'mock-model',
  maxTokens: 16_384,
  provider: 'mock-provider',
};

describe('sampleCompactionNote', () => {
  beforeEach(() => {
    mockGetInstalledCustomProviderIds.mockReset().mockReturnValue(['mock-provider']);
    mockResolvePiModel.mockReset().mockReturnValue(mockModel);
    mockResolvePiProviderAuth.mockReset().mockResolvedValue({
      auth: { apiKey: 'test-key', headers: { 'x-test': 'yes' } },
      env: { TEST_ENV: 'yes' },
    });
    mockStreamSimple.mockReset().mockReturnValue({
      result: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'final NOTE₂' }],
        stopReason: 'stop',
      }),
    });
  });

  it('passes structured roles and tool evidence to a tool-less low-reasoning sample', async () => {
    const host = { settings: { model: 'mock-provider/mock-model' } } as never;
    const messages = [
      { role: 'user', content: 'inspect [[Project]]', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-1',
          name: 'obsidian_read',
          arguments: { path: 'Project.md' },
        }],
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'obsidian_read',
        content: [{ type: 'text', text: 'verified note body' }],
        isError: false,
        timestamp: 3,
      },
    ] as never;

    await expect(
      sampleCompactionNote(host, messages, 'Create NOTE₂.'),
    ).resolves.toBe('final NOTE₂');

    expect(mockResolvePiModel).toHaveBeenCalledWith(host);
    expect(mockResolvePiProviderAuth).toHaveBeenCalledWith(host, mockModel);
    const [, context, options] = mockStreamSimple.mock.calls[0]!;
    expect(context).toMatchObject({
      messages: [
        { role: 'user', content: 'inspect [[Project]]' },
        { role: 'assistant' },
        { role: 'toolResult', toolName: 'obsidian_read' },
        { role: 'user', content: 'Create NOTE₂.' },
      ],
    });
    expect(context).not.toHaveProperty('tools');
    expect(options).toMatchObject({
      cacheRetention: 'none',
      maxRetries: 0,
      maxTokens: 8_192,
      reasoning: 'low',
      timeoutMs: 120_000,
    });
    expect(options.onPayload({ model: 'mock-model', tools: [] })).toEqual({
      model: 'mock-model',
    });
    const payloadWithTools = { model: 'mock-model', tools: [{ type: 'function' }] };
    expect(options.onPayload(payloadWithTools)).toBeUndefined();
  });

  it('leaves built-in provider payload compatibility to pi-ai', async () => {
    mockGetInstalledCustomProviderIds.mockReturnValue([]);

    await sampleCompactionNote(
      { settings: { model: 'mock-provider/mock-model' } } as never,
      [{ role: 'user', content: 'context', timestamp: 1 }] as never,
      'Create NOTE₂.',
    );

    const options = mockStreamSimple.mock.calls[0]![2];
    expect(options).not.toHaveProperty('onPayload');
  });

  it('does not start sampling when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sampleCompactionNote(
      { settings: { model: 'mock-provider/mock-model' } } as never,
      [{ role: 'user', content: 'context', timestamp: 1 }] as never,
      'Create NOTE₂.',
      controller.signal,
    )).rejects.toThrow('Cancelled');

    expect(mockResolvePiModel).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();
  });

  it('reports the internal deadline as a distinguishable timeout', async () => {
    jest.useFakeTimers();
    try {
      mockStreamSimple.mockImplementation((_model, _context, options) => ({
        result: () => new Promise(resolve => {
          options.signal.addEventListener('abort', () => resolve({
            content: [],
            stopReason: 'aborted',
          }), { once: true });
        }),
      }));

      const sampling = sampleCompactionNote(
        { settings: { model: 'mock-provider/mock-model' } } as never,
        [{ role: 'user', content: 'context', timestamp: 1 }] as never,
        'Create NOTE₂.',
      );
      const rejection = sampling.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(120_000);

      const error = await rejection;
      expect(error).toBeInstanceOf(PiCompactionTimeoutError);
      expect(error).toMatchObject({
        code: 'PI_COMPACTION_TIMEOUT',
        timeoutMs: 120_000,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('follows the configured provider total deadline', async () => {
    jest.useFakeTimers();
    try {
      mockStreamSimple.mockImplementation((_model, _context, options) => ({
        result: () => new Promise(resolve => {
          options.signal.addEventListener('abort', () => resolve({
            content: [],
            stopReason: 'aborted',
          }), { once: true });
        }),
      }));

      const sampling = sampleCompactionNote(
        {
          settings: {
            model: 'mock-provider/mock-model',
            providerRequestDeadlines: { totalMs: 300_000, idleMs: 0 },
          },
        } as never,
        [{ role: 'user', content: 'context', timestamp: 1 }] as never,
        'Create NOTE₂.',
      );
      const rejection = sampling.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(120_000);
      await jest.advanceTimersByTimeAsync(180_000);

      const error = await rejection;
      expect(error).toBeInstanceOf(PiCompactionTimeoutError);
      expect(error).toMatchObject({
        code: 'PI_COMPACTION_TIMEOUT',
        timeoutMs: 300_000,
        message: expect.stringContaining('300 seconds'),
      });
      expect(mockStreamSimple.mock.calls[0]![2]).toMatchObject({ timeoutMs: 300_000 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('disables the internal timer when the total deadline is zero', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      mockStreamSimple.mockImplementation((_model, _context, options) => ({
        result: () => new Promise(resolve => {
          options.signal.addEventListener('abort', () => resolve({
            content: [],
            stopReason: 'aborted',
          }), { once: true });
        }),
      }));

      const sampling = sampleCompactionNote(
        {
          settings: {
            model: 'mock-provider/mock-model',
            providerRequestDeadlines: { totalMs: 0, idleMs: 0 },
          },
        } as never,
        [{ role: 'user', content: 'context', timestamp: 1 }] as never,
        'Create NOTE₂.',
        controller.signal,
      );
      const rejection = sampling.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(86_400_000);
      expect(jest.getTimerCount()).toBe(0);
      expect(mockStreamSimple.mock.calls[0]![2]).not.toHaveProperty('timeoutMs');

      controller.abort();
      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Cancelled');
    } finally {
      jest.useRealTimers();
    }
  });

  it('disables the internal timer when the total deadline truncates to zero', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      mockStreamSimple.mockImplementation((_model, _context, options) => ({
        result: () => new Promise(resolve => {
          options.signal.addEventListener('abort', () => resolve({
            content: [],
            stopReason: 'aborted',
          }), { once: true });
        }),
      }));

      const sampling = sampleCompactionNote(
        {
          settings: {
            model: 'mock-provider/mock-model',
            providerRequestDeadlines: { totalMs: 0.5, idleMs: 0 },
          },
        } as never,
        [{ role: 'user', content: 'context', timestamp: 1 }] as never,
        'Create NOTE₂.',
        controller.signal,
      );
      const rejection = sampling.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(86_400_000);
      expect(jest.getTimerCount()).toBe(0);
      expect(mockStreamSimple.mock.calls[0]![2]).not.toHaveProperty('timeoutMs');

      controller.abort();
      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Cancelled');
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the default deadline for invalid configured values', async () => {
    await sampleCompactionNote(
      {
        settings: {
          model: 'mock-provider/mock-model',
          providerRequestDeadlines: { totalMs: Number.NaN, idleMs: 0 },
        },
      } as never,
      [{ role: 'user', content: 'context', timestamp: 1 }] as never,
      'Create NOTE₂.',
    );
    await sampleCompactionNote(
      {
        settings: {
          model: 'mock-provider/mock-model',
          providerRequestDeadlines: { totalMs: -5, idleMs: 0 },
        },
      } as never,
      [{ role: 'user', content: 'context', timestamp: 1 }] as never,
      'Create NOTE₂.',
    );

    expect(mockStreamSimple.mock.calls[0]![2]).toMatchObject({ timeoutMs: 120_000 });
    expect(mockStreamSimple.mock.calls[1]![2]).toMatchObject({ timeoutMs: 120_000 });
  });

  it('reports when the checkpoint output is truncated at the token limit', async () => {
    mockStreamSimple.mockReturnValue({
      result: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '```pivi-checkpoint\n{"continuationSummary":' }],
        stopReason: 'length',
      }),
    });

    await expect(sampleCompactionNote(
      { settings: { model: 'mock-provider/mock-model' } } as never,
      [{ role: 'user', content: 'context', timestamp: 1 }] as never,
      'Create NOTE₂.',
    )).rejects.toThrow(
      'Compaction model output reached the 8192-token limit before completing the checkpoint.',
    );
  });
});
