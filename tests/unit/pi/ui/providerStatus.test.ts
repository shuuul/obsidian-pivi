import { deriveProviderReadinessStatus } from '@/ui/settings/models-settings/providerStatus';

const basePiSettings = {
  disabledProviders: [],
  environmentVariables: '',
};

describe('deriveProviderReadinessStatus', () => {
  it('marks disabled providers before checking credentials', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: { ...basePiSettings, disabledProviders: ['anthropic'] },
      credential: { type: 'api-key', key: 'sk-test' },
      modelCount: 1,
    });

    expect(status.kind).toBe('disabled');
  });

  it('reports missing credentials without making network assumptions', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: basePiSettings,
      modelCount: 1,
    });

    expect(status.kind).toBe('missing-credential');
    expect(status.label).toBe('Missing credential');
  });

  it('treats local credentials as ready', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: basePiSettings,
      credential: { type: 'api-key', key: 'sk-test' },
      modelCount: 1,
    });

    expect(status.kind).toBe('ready');
    expect(status.label).toBe('Ready');
  });

  it('detects expired OAuth credentials when expiry is known', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'openai-codex',
      piSettings: basePiSettings,
      credential: { type: 'oauth', access: 'token', refresh: '', expires: 99 },
      modelCount: 1,
      now: 100,
    });

    expect(status.kind).toBe('oauth-expired');
  });

  it('marks providers without local model metadata as unavailable', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: basePiSettings,
      credential: { type: 'api-key', key: 'sk-test' },
      modelCount: 0,
    });

    expect(status.kind).toBe('unavailable');
  });
});
