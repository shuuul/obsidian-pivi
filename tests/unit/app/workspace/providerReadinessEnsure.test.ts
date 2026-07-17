import { deriveProviderReadinessStatus } from '@pivi/pivi-agent-core/auth/providerReadiness';
import { configurePiAiModels, piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { ObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';

import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';
import {
  ensureAddedProviderAuths,
  ensureProviderAuth,
} from '@/app/workspace/providerReadiness';

const grokBuildProbeModel = {
  provider: 'grok-build',
  id: 'grok-4.5',
  baseUrl: 'https://cli-chat-proxy.grok.com/v1',
};

describe('provider readiness credential preflight', () => {
  afterEach(() => {
    configurePiAiModels({});
    jest.restoreAllMocks();
  });

  it('refreshes interactive OAuth providers through pi-ai getAuth', async () => {
    const getAuth = jest.spyOn(piAiModels, 'getAuth').mockResolvedValue({
      auth: { apiKey: 'fresh-access' },
      source: 'OAuth',
    } as never);
    jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
      if (provider === 'grok-build') {
        return [grokBuildProbeModel as never];
      }
      return [];
    });

    await ensureProviderAuth('grok-build', { disabledProviders: [] });

    expect(getAuth).toHaveBeenCalledWith(grokBuildProbeModel);
  });

  it('skips disabled providers', async () => {
    const getAuth = jest.spyOn(piAiModels, 'getAuth').mockResolvedValue(undefined as never);

    await ensureProviderAuth('grok-build', { disabledProviders: ['grok-build'] });

    expect(getAuth).not.toHaveBeenCalled();
  });

  it('only preflights interactive OAuth providers in addedProviders', async () => {
    const getAuth = jest.spyOn(piAiModels, 'getAuth').mockResolvedValue({
      auth: { apiKey: 'fresh-access' },
      source: 'OAuth',
    } as never);
    jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
      if (provider === 'grok-build' || provider === 'openai-codex') {
        return [{ provider, id: 'mock-model' } as never];
      }
      return [];
    });

    await ensureAddedProviderAuths(
      ['anthropic', 'grok-build', 'openai-codex'],
      { disabledProviders: [] },
    );

    expect(getAuth).toHaveBeenCalledTimes(2);
    expect(getAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'grok-build' }));
    expect(getAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai-codex' }));
  });

  it('updates readiness after getAuth refreshes an expired OAuth credential', async () => {
    const stub = createMockPiviPluginStub();
    const plugin = asPiviPlugin(stub);
    const store = new ObsidianCredentialStore(plugin.app.secretStorage);
    configurePiAiModels({ credentials: store });
    const expired = Date.now() - 60_000;
    store.writeSync('grok-build', {
      type: 'oauth',
      access: 'stale-access',
      refresh: 'refresh-token',
      expires: expired,
    });

    jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
      if (provider === 'grok-build') {
        return [grokBuildProbeModel as never];
      }
      return [];
    });
    jest.spyOn(piAiModels, 'getAuth').mockImplementation(async (model) => {
      if (model.provider !== 'grok-build') {
        return undefined;
      }
      await store.modify('grok-build', async () => ({
        type: 'oauth',
        access: 'fresh-access',
        refresh: 'refresh-token',
        expires: Date.now() + 3_600_000,
      }));
      return { auth: { apiKey: 'fresh-access' }, source: 'OAuth' };
    });

    await ensureProviderAuth('grok-build', { disabledProviders: [] });

    const refreshed = store.readSync('grok-build');
    expect(refreshed?.type).toBe('oauth');
    expect(refreshed && 'expires' in refreshed && refreshed.expires).toBeGreaterThan(Date.now());

    const status = deriveProviderReadinessStatus({
      providerId: 'grok-build',
      piSettings: { disabledProviders: [], environmentVariables: '' },
      credential: refreshed,
      interactiveOAuthConnected: true,
      modelCount: 1,
    });
    expect(status.kind).toBe('ready');
  });

  it('logs getAuth rejections without throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(piAiModels, 'getAuth').mockRejectedValue(new Error('refresh failed'));
    jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
      if (provider === 'grok-build') {
        return [grokBuildProbeModel as never];
      }
      return [];
    });

    await expect(ensureProviderAuth('grok-build', { disabledProviders: [] })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[Pivi:ProviderReadiness] Failed to refresh OAuth credentials for grok-build',
      expect.any(Error),
    );
  });

  it('reuses a single in-flight preflight for the same interactive OAuth membership', async () => {
    let resolveGetAuth: ((value: { auth: { apiKey: string }; source: string }) => void) | undefined;
    const getAuth = jest.spyOn(piAiModels, 'getAuth').mockImplementation(() => new Promise((resolve) => {
      resolveGetAuth = resolve;
    }));
    jest.spyOn(piAiModels, 'getModels').mockImplementation((provider?: string) => {
      if (provider === 'grok-build') {
        return [grokBuildProbeModel as never];
      }
      return [];
    });

    const settings = { disabledProviders: [] as string[] };
    const firstFlight = ensureAddedProviderAuths(['grok-build'], settings);
    const secondFlight = ensureAddedProviderAuths(['grok-build'], settings);

    expect(getAuth).toHaveBeenCalledTimes(1);

    resolveGetAuth?.({ auth: { apiKey: 'fresh-access' }, source: 'OAuth' });
    await Promise.all([firstFlight, secondFlight]);
  });
});
