import {
  CODEX_OAUTH_PROVIDER_ID,
  type ProviderCredential,
} from '@pivi/pivi-agent-core/auth/PiProviderCredentials';
import { deriveProviderReadinessStatus } from '@pivi/pivi-agent-core/auth/providerReadiness';

const basePiSettings = {
  disabledProviders: [] as string[],
  environmentVariables: '',
};

describe('deriveProviderReadinessStatus (pivi-agent-core/auth)', () => {
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

  it('treats stored api-key credentials as ready', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: basePiSettings,
      credential: { type: 'api-key', key: 'sk-test' },
      modelCount: 1,
    });

    expect(status.kind).toBe('ready');
    expect(status.label).toBe('Ready');
  });

  it('treats environment API key variables as present credentials', () => {
    const status = deriveProviderReadinessStatus({
      providerId: 'anthropic',
      piSettings: { ...basePiSettings, environmentVariables: 'ANTHROPIC_API_KEY=sk-from-env' },
      modelCount: 1,
    });

    expect(status.kind).toBe('ready');
  });

  it('detects expired OAuth credentials when expiry is known', () => {
    const credential: ProviderCredential = {
      type: 'oauth',
      access: 'token',
      refresh: '',
      expires: 99,
    };
    const status = deriveProviderReadinessStatus({
      providerId: 'openai-codex',
      piSettings: basePiSettings,
      credential,
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

  it('treats codex as ready when codexConnected is true without a stored credential', () => {
    const status = deriveProviderReadinessStatus({
      providerId: CODEX_OAUTH_PROVIDER_ID,
      piSettings: basePiSettings,
      codexConnected: true,
      modelCount: 1,
    });

    expect(status.kind).toBe('ready');
  });
});