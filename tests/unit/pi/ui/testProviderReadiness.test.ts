import { requestUrl } from 'obsidian';

import { configurePiAiModels } from '../../../../src/pi/piAiModels';
import { testProviderReadiness } from '../../../../src/pi/ui/models-settings/testProviderReadiness';

const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>;

describe('testProviderReadiness', () => {
  afterEach(() => {
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
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    requestUrlMock.mockResolvedValue({ status: 204 } as never);

    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Credentials resolved from ANTHROPIC_API_KEY');
  });

  it('reports missing credentials before probing network', async () => {
    const result = await testProviderReadiness('anthropic', { disabledProviders: [] });

    expect(result).toMatchObject({ ok: false, detail: 'No credential resolved for anthropic.' });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
