import type { Provider, TranscriptContext } from '@earendil-works/pi-ai';

import { withScopedGoogleTransport } from '../../../../packages/engine-pi/src/models/scopedGoogleProvider';

function transcript(messages: never[] = []): TranscriptContext {
  return { messages } as unknown as TranscriptContext;
}

function createProvider(): Provider {
  return {
    id: 'mixed',
    name: 'Mixed provider',
    auth: { apiKey: {} as never },
    getModels: () => [],
    stream: jest.fn(() => ({}) as never),
    streamSimple: jest.fn(() => ({}) as never),
  };
}

describe('withScopedGoogleTransport', () => {
  it.each(['stream', 'streamSimple'] as const)(
    'verifies and removes the unsupported fetch option for Google %s',
    (method) => {
      const scopedFetch = jest.fn();
      const provider = createProvider();
      const wrapped = withScopedGoogleTransport(provider, () => scopedFetch as never);
      const model = { provider: 'mixed', api: 'google-generative-ai', id: 'gemini' } as never;
      const options = { apiKey: 'token', fetch: scopedFetch } as never;
      const context = transcript();

      wrapped[method](model, context, options);

      expect(provider[method]).toHaveBeenCalledWith(
        model,
        context,
        { apiKey: 'token' },
      );
    },
  );

  it('leaves non-Google API options and provider metadata unchanged', () => {
    const scopedFetch = jest.fn();
    const provider = createProvider();
    const wrapped = withScopedGoogleTransport(provider, () => scopedFetch as never);
    const model = { provider: 'mixed', api: 'openai-responses', id: 'other' } as never;
    const options = { fetch: scopedFetch } as never;
    const context = transcript();

    wrapped.streamSimple(model, context, options);

    expect(wrapped.id).toBe(provider.id);
    expect(wrapped.auth).toBe(provider.auth);
    expect(wrapped.getModels).toBe(provider.getModels);
    expect(provider.streamSimple).toHaveBeenCalledWith(model, context, options);
  });

  it('fails closed when Google does not receive the configured fetch', () => {
    const provider = createProvider();
    const scopedFetch = jest.fn();
    const wrapped = withScopedGoogleTransport(provider, () => scopedFetch as never);
    const model = { provider: 'google', api: 'google-generative-ai', id: 'gemini' } as never;

    expect(() => wrapped.streamSimple(
      model,
      transcript(),
      { fetch: jest.fn() } as never,
    )).toThrow('unexpected provider fetch');
    expect(provider.streamSimple).not.toHaveBeenCalled();
  });

  it('fails closed when composition has not configured a provider fetch', () => {
    const provider = createProvider();
    const wrapped = withScopedGoogleTransport(provider, () => undefined);
    const model = { provider: 'google', api: 'google-generative-ai', id: 'gemini' } as never;

    expect(() => wrapped.streamSimple(model, transcript(), undefined))
      .toThrow('requires the configured Pivi provider fetch');
    expect(provider.streamSimple).not.toHaveBeenCalled();
  });
});
