import { configurePiAiModels, piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import type { HttpClient, HttpResponse } from '@pivi/pivi-agent-core/ports';
import { testProviderReadiness } from '@/app/workspace/providerReadiness';

const httpFetch = jest.fn<ReturnType<HttpClient['fetch']>, Parameters<HttpClient['fetch']>>();

function mockHttpResponse(status: number): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => '',
    json: async <T>() => ({}) as T,
  };
}

jest.mock('@pivi/obsidian-host/createPiviNetworkClients', () => ({
  getActivePiviNetworkClients: () => ({
    httpClient: { fetch: httpFetch },
  }),
}));

const anthropicProbeModel = {
  provider: 'anthropic',
  id: 'mock-model',
  baseUrl: 'https://api.anthropic.com',
};

function stubAnthropicProbeModel(): jest.SpyInstance {
  return jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
    if (provider === 'anthropic') {
      return [anthropicProbeModel as never];
    }
    return [];
  });
}

describe('testProviderReadiness', () => {
  let getModelsSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    httpFetch.mockReset();
    httpFetch.mockResolvedValue(mockHttpResponse(200));
  });

  afterEach(() => {
    getModelsSpy?.mockRestore();
    getModelsSpy = undefined;
    configurePiAiModels({});
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('does not test disabled providers', async () => {
    await expect(testProviderReadiness('anthropic', { disabledProviders: ['anthropic'] }))
      .resolves.toMatchObject({ ok: false, detail: 'anthropic is disabled.' });
  });

  it('resolves auth through pi-ai before testing endpoint reachability', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(mockHttpResponse(204));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('credentials resolved from ANTHROPIC_API_KEY');
    expect(httpFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com',
        method: 'HEAD',
      }),
    );
  });

  it('skips network probe when model metadata has no baseUrl', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('no endpoint URL to probe locally');
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('treats 4xx HEAD responses as reachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(mockHttpResponse(404));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/responded with status 404/);
    expect(httpFetch).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('treats 5xx HEAD responses as unreachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(mockHttpResponse(503));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/responded with status 503/);
  });

  it('reports requestUrl failures with endpoint and message detail', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    httpFetch.mockRejectedValue(new Error('network down'));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('https://api.anthropic.com: network down');
  });

  it('reports missing credentials before probing network', async () => {
    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result).toMatchObject({ ok: false, detail: 'No credential resolved for anthropic.' });
    expect(httpFetch).not.toHaveBeenCalled();
  });
});
