import { requestUrl } from 'obsidian';

import { configurePiAiModels, piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { testProviderReadiness } from '@/app/workspace/providerReadiness';

const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>;

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

  afterEach(() => {
    getModelsSpy?.mockRestore();
    getModelsSpy = undefined;
    configurePiAiModels({});
    requestUrlMock.mockReset();
    requestUrlMock.mockResolvedValue({ status: 200 } as never);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('does not test disabled providers', async () => {
    await expect(testProviderReadiness('anthropic', { disabledProviders: ['anthropic'] }))
      .resolves.toMatchObject({ ok: false, detail: 'anthropic is disabled.' });
  });

  it('resolves auth through pi-ai before testing endpoint reachability', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    requestUrlMock.mockResolvedValue({ status: 204 } as never);

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('credentials resolved from ANTHROPIC_API_KEY');
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com',
        method: 'HEAD',
        throw: false,
      }),
    );
  });

  it('skips network probe when model metadata has no baseUrl', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('no endpoint URL to probe locally');
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it('treats 4xx HEAD responses as reachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    requestUrlMock.mockResolvedValue({ status: 404 } as never);

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/responded with status 404/);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'HEAD', throw: false }),
    );
  });

  it('treats 5xx HEAD responses as unreachable for provider readiness', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    requestUrlMock.mockResolvedValue({ status: 503 } as never);

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/responded with status 503/);
  });

  it('reports requestUrl failures with endpoint and message detail', async () => {
    getModelsSpy = stubAnthropicProbeModel();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    requestUrlMock.mockRejectedValue(new Error('network down'));

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('https://api.anthropic.com: network down');
  });

  it('reports missing credentials before probing network', async () => {
    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result).toMatchObject({ ok: false, detail: 'No credential resolved for anthropic.' });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
