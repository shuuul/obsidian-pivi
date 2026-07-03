import { configurePiAiModels } from '@pivi/pivi-agent-core/engine/pi/PiAiModels';
import { resolvePiModel, resolvePiProviderAuth } from '@pivi/pivi-agent-core/engine/pi/PiModelEnv';
import {
  ObsidianAuthContext,
  ObsidianCredentialStore,
} from '@pivi/pivi-agent-core/engine/pi/PiProviderCredentialStore';
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
    store.writeSync('anthropic', { type: 'api-key', key: 'stored-key' });
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
});
