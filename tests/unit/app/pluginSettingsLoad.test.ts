import {
  getPiAiCredentialSecretId,
  serializeProviderCredential,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import {
  getPiAgentSettings,
  updatePiAgentSettings,
} from '@pivi/pivi-agent-core/foundation/agentSettings';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';

import {
  migrateProviderSecretsToKeychain,
  type PluginSettingsLoadContext,
} from '@/app/pluginSettingsLoad';
import { createMockApp } from '../../helpers/mockApp';

describe('plugin settings provider credential migration', () => {
  it('eagerly moves legacy OAuth selections into the independent subscription namespace', () => {
    const app = createMockApp();
    const settings = structuredClone(DEFAULT_PIVI_SETTINGS);
    updatePiAgentSettings(settings as unknown as Record<string, unknown>, {
      addedProviders: ['xai'],
      disabledProviders: ['xai'],
      environmentVariables: 'XAI_API_KEY=api-key',
      visibleModels: ['xai/grok-3'],
    });
    settings.model = 'xai/grok-3';
    settings.titleGenerationModel = 'xai/grok-3';
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('xai'),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-access' }),
    );
    const context = {
      app,
      getSettings: () => settings,
    } as unknown as PluginSettingsLoadContext;

    expect(migrateProviderSecretsToKeychain(context)).toBe(true);

    const migrated = getPiAgentSettings(settings as unknown as Record<string, unknown>);
    expect(migrated.addedProviders).toEqual(['xai', 'grok-build']);
    expect(migrated.disabledProviders).toEqual(['grok-build']);
    expect(migrated.visibleModels).toEqual(['grok-build/grok-composer-2.5-fast']);
    expect(migrated.environmentVariables).toBe('');
    expect(settings.model).toBe('grok-build/grok-composer-2.5-fast');
    expect(settings.titleGenerationModel).toBe('grok-build/grok-composer-2.5-fast');
    expect(JSON.parse(app.secretStorage.getSecret(getPiAiCredentialSecretId('xai'))!))
      .toEqual({ type: 'api_key', key: 'api-key' });
    expect(JSON.parse(app.secretStorage.getSecret(getPiAiCredentialSecretId('grok-build'))!))
      .toMatchObject({ type: 'oauth', access: 'legacy-access' });
    expect(migrateProviderSecretsToKeychain(context)).toBe(false);
  });

  it('deduplicates legacy xAI models that converge on the Grok Build fallback', () => {
    const app = createMockApp();
    const settings = structuredClone(DEFAULT_PIVI_SETTINGS);
    updatePiAgentSettings(settings as unknown as Record<string, unknown>, {
      addedProviders: ['xai'],
      visibleModels: ['xai/grok-3', 'xai/grok-4'],
    });
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('xai'),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-access' }),
    );
    const context = {
      app,
      getSettings: () => settings,
    } as unknown as PluginSettingsLoadContext;

    expect(migrateProviderSecretsToKeychain(context)).toBe(true);
    expect(getPiAgentSettings(settings as unknown as Record<string, unknown>).visibleModels)
      .toEqual(['grok-build/grok-composer-2.5-fast']);
  });

  it('preserves backing selections and adds subscription aliases when both identities exist', () => {
    const app = createMockApp();
    const settings = structuredClone(DEFAULT_PIVI_SETTINGS);
    updatePiAgentSettings(settings as unknown as Record<string, unknown>, {
      addedProviders: ['xai', 'grok-build', 'anthropic', 'claude'],
      disabledProviders: ['xai', 'anthropic'],
      visibleModels: ['xai/grok-3', 'anthropic/claude-sonnet-4'],
    });
    settings.model = 'xai/grok-3';
    settings.titleGenerationModel = 'anthropic/claude-sonnet-4';
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('xai'),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-xai' }),
    );
    app.secretStorage.setSecret(
      getPiAiCredentialSecretId('anthropic'),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-anthropic' }),
    );
    const context = {
      app,
      getSettings: () => settings,
    } as unknown as PluginSettingsLoadContext;

    expect(migrateProviderSecretsToKeychain(context)).toBe(true);

    const migrated = getPiAgentSettings(settings as unknown as Record<string, unknown>);
    expect(migrated.visibleModels).toEqual([
      'xai/grok-3',
      'anthropic/claude-sonnet-4',
      'grok-build/grok-composer-2.5-fast',
      'claude/claude-sonnet-4',
    ]);
    expect(migrated.disabledProviders).toEqual(['xai', 'anthropic']);
    expect(settings.model).toBe('xai/grok-3');
    expect(settings.titleGenerationModel).toBe('anthropic/claude-sonnet-4');
  });
});
