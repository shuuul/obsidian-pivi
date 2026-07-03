import { SecretStorage, requestUrl } from 'obsidian';

import { createObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import { ProviderOAuthService } from '@pivi/pivi-agent-core/engine/pi/piProviderOAuthService';
import { configurePiAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { PI_AI_MODELS_CACHE, type PiCachedModel } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry'
import { derivePiModelReadinessStatus } from '@/ui/settings/modelReadiness';
import { testModelReadiness } from '@/ui/settings/models-settings/testProviderReadiness';


const mockOAuthFlowHost = { openAuthUrl: jest.fn().mockResolvedValue(undefined) };
const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>;

function settingsBag(overrides: Parameters<typeof updatePiAgentSettings>[1] = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updatePiAgentSettings(settings, {
    addedProviders: ['anthropic'],
    disabledProviders: [],
    environmentVariables: '',
    visibleModels: ['anthropic/test-model'],
    ...overrides,
  });
  return settings;
}

describe('Pi model readiness', () => {
  beforeEach(() => {
    PI_AI_MODELS_CACHE.set('anthropic/test-model', {
      provider: 'anthropic',
      id: 'test-model',
      name: 'Test model',
      reasoning: false,
      contextWindow: 200_000,
    } as PiCachedModel);
    requestUrlMock.mockResolvedValue({ status: 204 } as never);
  });

  afterEach(() => {
    PI_AI_MODELS_CACHE.delete('anthropic/test-model');
    configurePiAiModels({});
    requestUrlMock.mockReset();
    requestUrlMock.mockResolvedValue({ status: 200 } as never);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('uses the same provider readiness labels for model picker status', () => {
    const secretStorage = new SecretStorage();
    const credentialStore = createObsidianCredentialStore(secretStorage);
    credentialStore?.writeSync('anthropic', { type: 'api_key', key: 'sk-test' });

    const status = derivePiModelReadinessStatus(
      'anthropic/test-model',
      settingsBag(),
      {
        credentialStore,
        providerOAuth: new ProviderOAuthService(credentialStore, mockOAuthFlowHost),
      },
    );

    expect(status).toMatchObject({ kind: 'ready', label: 'Ready' });
  });

  it('reports disabled providers at the model level', () => {
    const status = derivePiModelReadinessStatus(
      'anthropic/test-model',
      settingsBag({ disabledProviders: ['anthropic'] }),
      {
        credentialStore: null,
        providerOAuth: new ProviderOAuthService(null, mockOAuthFlowHost),
      },
    );

    expect(status.kind).toBe('disabled');
  });

  it('tests the selected model through pi-ai auth resolution', async () => {
    process.env.ANTHROPIC_API_KEY = '[REDACTED:api-key]';

    const result = await testModelReadiness('anthropic/test-model', { disabledProviders: [] });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Credentials resolved from ANTHROPIC_API_KEY');
  });
});
