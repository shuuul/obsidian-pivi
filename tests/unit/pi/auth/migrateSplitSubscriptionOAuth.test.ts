import {
  ANTHROPIC_PROVIDER_ID,
  CLAUDE_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  XAI_PROVIDER_ID,
  getPiAiCredentialSecretId,
  serializeProviderCredential,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { migrateSplitSubscriptionOAuthCredentials } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import { createMockApp } from '../../../helpers/mockApp';

describe('migrateSplitSubscriptionOAuthCredentials', () => {
  it('moves oauth off API-provider slots into plan-provider slots and appends providers', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(ANTHROPIC_PROVIDER_ID),
      serializeProviderCredential({
        type: 'oauth',
        access: 'anthropic-access',
        refresh: 'anthropic-refresh',
        expires: Date.now() + 3600_000,
      }),
    );

    const result = migrateSplitSubscriptionOAuthCredentials(secretStorage, [ANTHROPIC_PROVIDER_ID, XAI_PROVIDER_ID]);

    expect(result.changed).toBe(true);
    expect(result.migratedPiProviderIds).toEqual([ANTHROPIC_PROVIDER_ID]);
    expect(result.addedProviders).toEqual(
      expect.arrayContaining([ANTHROPIC_PROVIDER_ID, XAI_PROVIDER_ID, CLAUDE_PROVIDER_ID]),
    );
    expect(secretStorage.getSecret(getPiAiCredentialSecretId(ANTHROPIC_PROVIDER_ID))).toBeFalsy();
    expect(JSON.parse(secretStorage.getSecret(getPiAiCredentialSecretId(CLAUDE_PROVIDER_ID))!)).toMatchObject({
      type: 'oauth',
      access: 'anthropic-access',
    });
  });

  it('appends subscription providers when oauth already lives in the subscription slot', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID),
      serializeProviderCredential({
        type: 'oauth',
        access: 'xai-access',
        refresh: 'xai-refresh',
        expires: Date.now() + 3600_000,
      }),
    );

    const result = migrateSplitSubscriptionOAuthCredentials(secretStorage, [XAI_PROVIDER_ID]);

    expect(result.changed).toBe(true);
    expect(result.migratedPiProviderIds).toEqual([]);
    expect(result.addedProviders).toContain(GROK_BUILD_PROVIDER_ID);
  });

  it('does not resurrect subscription providers from orphan oauth alone', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID),
      serializeProviderCredential({
        type: 'oauth',
        access: 'xai-access',
        refresh: 'xai-refresh',
        expires: Date.now() + 3600_000,
      }),
    );

    const result = migrateSplitSubscriptionOAuthCredentials(secretStorage, ['deepseek']);

    expect(result.changed).toBe(false);
    expect(result.addedProviders).toEqual(['deepseek']);
    expect(result.addedProviders).not.toContain(GROK_BUILD_PROVIDER_ID);
  });

  it('preserves an existing subscription credential while clearing the legacy slot', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(XAI_PROVIDER_ID),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-access' }),
    );
    secretStorage.setSecret(
      getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID),
      serializeProviderCredential({ type: 'oauth', access: 'current-access' }),
    );

    const result = migrateSplitSubscriptionOAuthCredentials(secretStorage, [XAI_PROVIDER_ID]);

    expect(result.migratedPiProviderIds).toEqual([XAI_PROVIDER_ID]);
    expect(result.addedProviders).toEqual([XAI_PROVIDER_ID, GROK_BUILD_PROVIDER_ID]);
    expect(secretStorage.getSecret(getPiAiCredentialSecretId(XAI_PROVIDER_ID))).toBeFalsy();
    expect(JSON.parse(secretStorage.getSecret(getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID))!))
      .toMatchObject({ access: 'current-access' });
  });

  it('preserves an existing destination credential of any kind', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(XAI_PROVIDER_ID),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-access' }),
    );
    secretStorage.setSecret(
      getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID),
      serializeProviderCredential({ type: 'api_key', key: 'keep-existing' }),
    );

    const result = migrateSplitSubscriptionOAuthCredentials(secretStorage, [XAI_PROVIDER_ID]);

    expect(result.migratedPiProviderIds).toEqual([]);
    expect(result.addedProviders).toEqual([XAI_PROVIDER_ID]);
    expect(secretStorage.getSecret(getPiAiCredentialSecretId(XAI_PROVIDER_ID))).toBeFalsy();
    expect(JSON.parse(secretStorage.getSecret(getPiAiCredentialSecretId(GROK_BUILD_PROVIDER_ID))!))
      .toEqual({ type: 'api_key', key: 'keep-existing' });
  });

  it('is idempotent after credentials and provider membership are migrated', () => {
    const app = createMockApp();
    const { secretStorage } = app;
    secretStorage.setSecret(
      getPiAiCredentialSecretId(XAI_PROVIDER_ID),
      serializeProviderCredential({ type: 'oauth', access: 'legacy-access' }),
    );
    const first = migrateSplitSubscriptionOAuthCredentials(secretStorage, [XAI_PROVIDER_ID]);

    const second = migrateSplitSubscriptionOAuthCredentials(secretStorage, first.addedProviders);

    expect(second).toEqual({
      addedProviders: first.addedProviders,
      migratedPiProviderIds: [],
      changed: false,
    });
  });
});
