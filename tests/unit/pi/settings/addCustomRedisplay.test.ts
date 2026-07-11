import { isBuiltinPiProviderId } from '@pivi/pivi-agent-core/auth/piProviderValidation';
import { migratePiProviderCredentialsToKeychain } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import { updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { createDefaultCustomProviderConfig } from '@pivi/pivi-agent-core/foundation/customProviders';

describe('add ollama then redisplay normalize', () => {
  it('keeps ollama after addedProviders-only update like migration path', () => {
    const settings: Record<string, unknown> = {
      agentSettings: {
        addedProviders: ['deepseek'],
        disabledProviders: [],
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: ['deepseek/deepseek-chat'],
      },
    };
    const config = createDefaultCustomProviderConfig('ollama', []);
    let view = updatePiAgentSettings(settings, {
      customProviders: [config],
      addedProviders: ['deepseek', 'ollama'],
    });
    expect(view.addedProviders).toEqual(['deepseek', 'ollama']);
    expect(view.customProviders.map((p) => p.id)).toEqual(['ollama']);

    // redisplay migration-like update
    const customIds = new Set(view.customProviders.map((p) => p.id));
    const supportedAddedProviders = view.addedProviders.filter(
      (id) => isBuiltinPiProviderId(id) || customIds.has(id),
    );
    view = updatePiAgentSettings(settings, {
      addedProviders: supportedAddedProviders,
      environmentVariables: view.environmentVariables,
    });
    expect(view.addedProviders).toContain('ollama');
    expect(view.customProviders.map((p) => p.id)).toEqual(['ollama']);
    expect((settings.agentSettings as any).customProviders).toHaveLength(1);
  });

  it('credential migration preserves custom provider ids', () => {
    const secretStorage = {
      getSecret: () => null,
      setSecret: jest.fn(),
      listSecrets: () => [] as string[],
    };

    const result = migratePiProviderCredentialsToKeychain(
      secretStorage,
      ['deepseek', 'ollama', 'lmstudio'],
      '',
    );

    expect(result.addedProviders).toEqual(
      expect.arrayContaining(['deepseek', 'ollama', 'lmstudio']),
    );
    expect(result.addedProviders).toHaveLength(3);
  });
});
