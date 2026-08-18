import { configurePiAiModels, piAiModels } from '@pivi/engine-pi/piAiModels';
import type { HttpClient, HttpResponse } from '@pivi/agent/ports';
import { testProviderReadiness } from '@/app/workspace/providerReadiness';

const httpFetch = jest.fn<ReturnType<HttpClient['fetch']>, Parameters<HttpClient['fetch']>>();
const providerHttpFetch = jest.fn<ReturnType<HttpClient['fetch']>, Parameters<HttpClient['fetch']>>();

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
    localProviderHttpClient: { fetch: providerHttpFetch },
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
    providerHttpFetch.mockReset();
    providerHttpFetch.mockResolvedValue(mockHttpResponse(200));
  });

  afterEach(() => {
    getModelsSpy?.mockRestore();
    getModelsSpy = undefined;
    configurePiAiModels({});
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('does not test disabled providers', async () => {
    await expect(testProviderReadiness('anthropic', { disabledProviders: ['anthropic'], customProviders: [] }))
      .resolves.toMatchObject({ ok: false, detail: 'anthropic is disabled.' });
  });

  it('resolves auth through pi-ai before testing endpoint reachability', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    providerHttpFetch.mockResolvedValue(mockHttpResponse(204));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('credentials resolved from ANTHROPIC_API_KEY');
    expect(providerHttpFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com',
        method: 'HEAD',
      }),
    );
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('skips network probe when model metadata has no baseUrl', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('no endpoint URL to probe locally');
    expect(httpFetch).not.toHaveBeenCalled();
    expect(providerHttpFetch).not.toHaveBeenCalled();
  });

  it('treats 4xx HEAD responses as reachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    providerHttpFetch.mockResolvedValue(mockHttpResponse(404));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/responded with status 404/);
    expect(providerHttpFetch).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('treats 5xx HEAD responses as unreachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    providerHttpFetch.mockResolvedValue(mockHttpResponse(503));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/responded with status 503/);
  });

  it('reports requestUrl failures with endpoint and message detail', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    providerHttpFetch.mockRejectedValue(new Error('network down'));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('https://api.anthropic.com: network down');
  });

  it('reports missing credentials before probing network', async () => {
    const result = await testProviderReadiness('anthropic', { disabledProviders: [], customProviders: [] });

    expect(result).toMatchObject({ ok: false, detail: 'No credential resolved for anthropic.' });
    expect(httpFetch).not.toHaveBeenCalled();
    expect(providerHttpFetch).not.toHaveBeenCalled();
  });

  it('probes a keyless private OpenAI-compatible provider without models or credentials', async () => {
    providerHttpFetch.mockResolvedValue(mockHttpResponse(200));

    const result = await testProviderReadiness('custom-openai-compatible-lan', {
      disabledProviders: [],
      customProviders: [{
        id: 'custom-openai-compatible-lan',
        kind: 'openai-compatible',
        name: 'vLLM',
        baseUrl: 'http://192.168.100.177:8888/v1',
        api: 'openai-completions',
        apiKeyRequired: false,
        models: [],
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('http://192.168.100.177:8888/v1/models');
    expect(result.detail).toContain('no API key required');
    expect(providerHttpFetch).toHaveBeenCalledWith({
      url: 'http://192.168.100.177:8888/v1/models',
      method: 'GET',
    });
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('does not require stored models before testing a custom provider URL', async () => {
    providerHttpFetch.mockResolvedValue(mockHttpResponse(200));

    const result = await testProviderReadiness('custom-openai-compatible-cloud', {
      disabledProviders: [],
      customProviders: [{
        id: 'custom-openai-compatible-cloud',
        kind: 'openai-compatible',
        name: 'Proxy',
        baseUrl: 'https://api.example.test/v1',
        api: 'openai-completions',
        apiKeyRequired: true,
        models: [],
      }],
    });

    expect(result.ok).toBe(true);
    expect(providerHttpFetch).toHaveBeenCalledWith({
      url: 'https://api.example.test/v1/models',
      method: 'GET',
    });
  });
});
