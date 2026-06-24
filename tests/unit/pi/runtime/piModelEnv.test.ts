import { configurePiAiModels } from '../../../../src/pi/piAiModels';
import { resolvePiModel, resolvePiProviderAuth } from '../../../../src/pi/runtime/piModelEnv';
import {
  ObsidianAuthContext,
  ObsidianCredentialStore,
} from '../../../../src/pi/auth/ObsidianCredentialStore';
import { createMockObsiusPluginStub, asObsiusPlugin } from '../../../helpers/mockObsiusPlugin';

describe('piModelEnv provider auth resolution', () => {
  afterEach(() => {
    configurePiAiModels({});
  });

  it('resolves credentials through pi-ai with SecretStorage taking precedence over env snippets', async () => {
    const stub = createMockObsiusPluginStub({
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
    const plugin = asObsiusPlugin(stub);
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
    const stub = createMockObsiusPluginStub({
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
    const plugin = asObsiusPlugin(stub);
    configurePiAiModels({
      credentials: new ObsidianCredentialStore(plugin.app.secretStorage),
      authContext: new ObsidianAuthContext(plugin),
    });

    const model = resolvePiModel(plugin, 'anthropic/mock-model');
    expect(model).not.toBeNull();

    await expect(resolvePiProviderAuth(plugin, model!)).resolves.toBeUndefined();
  });
});
