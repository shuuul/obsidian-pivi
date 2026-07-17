import {
  ANTHROPIC_PROVIDER_ID,
  CLAUDE_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  XAI_PROVIDER_ID,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import {
  configurePiAiModels,
  piAiModels,
} from '@pivi/pivi-agent-core/engine/pi/piAiModels';

describe('split subscription provider identities', () => {
  afterEach(() => {
    configurePiAiModels({});
  });

  it.each([
    [ANTHROPIC_PROVIDER_ID, CLAUDE_PROVIDER_ID],
  ])('separates %s API-key models from %s OAuth models', (apiProviderId, planProviderId) => {
    configurePiAiModels({});

    const apiProvider = piAiModels.getProvider(apiProviderId);
    const planProvider = piAiModels.getProvider(planProviderId);
    expect(apiProvider?.auth.apiKey).toBeDefined();
    expect(apiProvider?.auth.oauth).toBeUndefined();
    expect(planProvider?.auth.oauth).toBeDefined();
    expect(planProvider?.auth.apiKey).toBeUndefined();
    expect(piAiModels.getModels(apiProviderId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: apiProviderId }),
    ]));
    expect(piAiModels.getModels(planProviderId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: planProviderId }),
    ]));
  });

  it('mirrors the xAI model list into the isolated Grok Build subscription namespace', () => {
    configurePiAiModels({});

    const apiProvider = piAiModels.getProvider(XAI_PROVIDER_ID);
    const planProvider = piAiModels.getProvider(GROK_BUILD_PROVIDER_ID);
    const apiModels = piAiModels.getModels(XAI_PROVIDER_ID);
    const planModels = piAiModels.getModels(GROK_BUILD_PROVIDER_ID);

    expect(apiProvider?.auth.apiKey).toBeDefined();
    expect(apiProvider?.auth.oauth).toBeUndefined();
    expect(planProvider?.auth.oauth).toBeDefined();
    expect(planProvider?.auth.apiKey).toBeUndefined();
    expect(apiModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: XAI_PROVIDER_ID, id: 'mock-model' }),
    ]));
    expect(planModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: GROK_BUILD_PROVIDER_ID, id: 'mock-model' }),
    ]));
  });
});
