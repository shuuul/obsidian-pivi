const mockResolvePiModel = jest.fn();
const mockResolvePiProviderAuth = jest.fn();
const mockStreamSimple = jest.fn();

jest.mock('@pivi/pivi-agent-core/engine/pi/piModelEnv', () => ({
  resolvePiModel: (...args: unknown[]) => mockResolvePiModel(...args),
  resolvePiProviderAuth: (...args: unknown[]) => mockResolvePiProviderAuth(...args),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/piAiModels', () => ({
  piAiModels: {
    streamSimple: (...args: unknown[]) => mockStreamSimple(...args),
  },
}));

import { sampleCompactionNote } from '../../../../packages/pivi-agent-core/src/engine/pi/piCompactionSampler';

const mockModel = {
  id: 'mock-model',
  maxTokens: 16_384,
  provider: 'mock-provider',
};

describe('sampleCompactionNote', () => {
  beforeEach(() => {
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
});
