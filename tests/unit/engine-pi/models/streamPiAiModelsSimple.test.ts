import {
  configurePiAiModels,
  piAiModels,
  streamPiAiModelsSimple,
} from '../../../../packages/engine-pi/src/models/piAiModels';

describe('streamPiAiModelsSimple', () => {
  const streamSimple = jest.fn().mockReturnValue({ result: async () => ({}) });
  let originalStreamSimple: typeof piAiModels.streamSimple;

  beforeAll(() => {
    originalStreamSimple = piAiModels.streamSimple;
  });

  beforeEach(() => {
    streamSimple.mockClear();
    configurePiAiModels({});
    piAiModels.streamSimple = streamSimple as typeof piAiModels.streamSimple;
  });

  afterAll(() => {
    piAiModels.streamSimple = originalStreamSimple;
  });

  it('pins openai-codex to SSE when the caller did not choose a transport', () => {
    streamPiAiModelsSimple(
      { provider: 'openai-codex', id: 'gpt-5.3-codex-spark' } as never,
      { messages: [] } as never,
      { apiKey: 'token' },
    );

    expect(streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-codex' }),
      expect.anything(),
      expect.objectContaining({ apiKey: 'token', transport: 'sse' }),
    );
  });

  it('passes the configured provider fetch to Pi 0.83 streams', () => {
    const providerFetch = jest.fn();
    configurePiAiModels({ providerFetch });
    piAiModels.streamSimple = streamSimple as typeof piAiModels.streamSimple;

    streamPiAiModelsSimple(
      { provider: 'openai-codex', id: 'gpt-5.3-codex-spark' } as never,
      { messages: [] } as never,
      { apiKey: 'token' },
    );

    expect(streamSimple).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ fetch: providerFetch, transport: 'sse' }),
    );
  });

  it('preserves an explicit transport and leaves non-codex providers alone', () => {
    streamPiAiModelsSimple(
      { provider: 'openai-codex', id: 'gpt-5.3-codex-spark' } as never,
      { messages: [] } as never,
      { transport: 'websocket' },
    );
    streamPiAiModelsSimple(
      { provider: 'anthropic', id: 'claude' } as never,
      { messages: [] } as never,
      { apiKey: 'token' },
    );

    expect(streamSimple).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ transport: 'websocket' }),
    );
    expect(streamSimple).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ apiKey: 'token' }),
    );
    expect(streamSimple.mock.calls[1]?.[2]).not.toHaveProperty('transport');
  });
});
