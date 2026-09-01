import { configurePiAiModels } from '@pivi/engine-pi/piAiModels';
import {
  resolvePiModel,
  resolvePiModelByKey,
  resolvePiProviderAuth,
} from '@pivi/engine-pi/piModelEnv';
import {
  ObsidianAuthContext,
  ObsidianCredentialStore,
} from '@pivi/engine-pi/piProviderCredentialStore';
import { createMockPiviPluginStub, asPiviPlugin } from '../../../helpers/mockPiviPlugin';

describe('piModelEnv provider auth resolution', () => {
  afterEach(() => {
    configurePiAiModels({});
  });

  it('resolves credentials through pi-ai with SecretStorage taking precedence over env snippets', async () => {
    const stub = createMockPiviPluginStub({
      settings: {
        model: 'anthropic/mock-model',
        sharedEnvironmentVariables: 'ANTHROPIC_API_KEY=shared-env-key',
        agentSettings: {
          environmentVariables: 'ANTHROPIC_API_KEY=pi-env-key',
          selectedMode: 'default',
          visibleModels: ['anthropic/mock-model'],
        },
      },
    });
    const plugin = asPiviPlugin(stub);
    const store = new ObsidianCredentialStore(plugin.app.secretStorage);
    store.writeSync('anthropic', { type: 'api_key', key: 'stored-key' });
    configurePiAiModels({
      credentials: store,
      authContext: new ObsidianAuthContext(plugin),
    });

    const model = resolvePiModel(plugin, 'anthropic/mock-model');
    expect(model).not.toBeNull();

    const auth = await resolvePiProviderAuth(plugin, model!);

    expect(auth).toMatchObject({
      auth: { apiKey: 'stored-key' },
      source: 'stored credential',
    });
  });

  it('returns no auth for disabled providers even when env credentials exist', async () => {
    const stub = createMockPiviPluginStub({
      settings: {
        model: 'anthropic/mock-model',
        agentSettings: {
          disabledProviders: ['anthropic'],
          environmentVariables: 'ANTHROPIC_API_KEY=pi-env-key',
          selectedMode: 'default',
          visibleModels: ['anthropic/mock-model'],
        },
      },
    });
    const plugin = asPiviPlugin(stub);
    configurePiAiModels({
      credentials: new ObsidianCredentialStore(plugin.app.secretStorage),
      authContext: new ObsidianAuthContext(plugin),
    });

    const model = resolvePiModel(plugin, 'anthropic/mock-model');
    expect(model).not.toBeNull();

    await expect(resolvePiProviderAuth(plugin, model!)).resolves.toBeUndefined();
  });

  it('resolves Anthropic auth tokens as bearer headers', async () => {
    const stub = createMockPiviPluginStub({
      settings: {
        model: 'anthropic/mock-model',
        agentSettings: {
          environmentVariables: 'ANTHROPIC_AUTH_TOKEN=bearer-token',
          selectedMode: 'default',
          visibleModels: ['anthropic/mock-model'],
        },
      },
    });
    const plugin = asPiviPlugin(stub);
    configurePiAiModels({
      credentials: new ObsidianCredentialStore(plugin.app.secretStorage),
      authContext: new ObsidianAuthContext(plugin),
    });

    const model = resolvePiModel(plugin, 'anthropic/mock-model');

    await expect(resolvePiProviderAuth(plugin, model!)).resolves.toMatchObject({
      auth: { headers: { Authorization: 'Bearer bearer-token' } },
    });
  });

  it('applies the configured context-window override to runtime model resolution', () => {
    const modelKey = 'anthropic/mock-model';
    const stub = createMockPiviPluginStub({
      settings: {
        model: modelKey,
        customContextLimits: { [modelKey]: 4_096 },
        agentSettings: {
          environmentVariables: '',
          selectedMode: 'default',
          visibleModels: [modelKey],
        },
      },
    });
    const plugin = asPiviPlugin(stub);
    configurePiAiModels({});

    expect(resolvePiModel(plugin)).toMatchObject({
      contextWindow: 4_096,
      contextWindowIsAuthoritative: true,
      maxTokens: 4_096,
    });
    expect(resolvePiModelByKey(modelKey, plugin.settings.customContextLimits)).toMatchObject({
      contextWindow: 4_096,
      contextWindowIsAuthoritative: true,
      maxTokens: 4_096,
    });
  });
});
