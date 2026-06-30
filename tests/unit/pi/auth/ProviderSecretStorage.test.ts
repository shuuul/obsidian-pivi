import {
  credentialToApiKey,
  getPiAiCredentialSecretId,
  migratePiProviderCredentialsToKeychain,
  ObsidianCredentialStore,
} from '../../../../src/pi/auth/ObsidianCredentialStore';
import {
  getProviderCredentialSecretId,
  isProviderDisabled,
  parseProviderCredentialSecretId,
} from '../../../../src/pi/auth/ProviderSecretStorage';
import { SecretStorage } from 'obsidian';

describe('ProviderSecretStorage', () => {
  let secretStorage: SecretStorage;

  beforeEach(() => {
    secretStorage = new SecretStorage();
  });

  function setLegacyProviderSecret(providerId: string, kind: 'api-key' | 'oauth-token', secret: string): void {
    secretStorage.setSecret(getProviderCredentialSecretId(providerId, kind), secret);
  }

  it('builds stable secret ids per provider', () => {
    expect(getPiAiCredentialSecretId('anthropic')).toBe('pivi-anthropic-credential');
    expect(getProviderCredentialSecretId('anthropic', 'api-key')).toBe('pivi-anthropic-api-key');
    expect(parseProviderCredentialSecretId('pivi-openai-api-key')).toEqual({
      providerId: 'openai',
      kind: 'api-key',
    });
  });

  it('writes only the canonical provider credential key for new credentials', () => {
    const store = new ObsidianCredentialStore(secretStorage);

    store.writeSync('anthropic', { type: 'api-key', key: 'sk-test' });

    expect(secretStorage.listSecrets()).toEqual([getPiAiCredentialSecretId('anthropic')]);
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'sk-test' }),
    );
  });

  it('does not read legacy provider key slots without migration', async () => {
    setLegacyProviderSecret('anthropic', 'api-key', 'sk-legacy');
    const store = new ObsidianCredentialStore(secretStorage);

    expect(await store.read('anthropic')).toBeUndefined();
    expect(credentialToApiKey(store.readSync('anthropic'))).toBeUndefined();
  });

  it('hard-migrates plaintext env values into the canonical key', () => {
    const env = 'ANTHROPIC_API_KEY=sk-plain\nPI_ENABLE_EXA=1';
    const result = migratePiProviderCredentialsToKeychain(
      secretStorage,
      ['anthropic'],
      env,
    );

    expect(result.changed).toBe(true);
    expect(result.environmentVariables).not.toContain('sk-plain');
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'sk-plain' }),
    );
    expect(new ObsidianCredentialStore(secretStorage).readSync('anthropic')).toEqual({
      type: 'api-key',
      key: 'sk-plain',
    });
  });

  it('hard-migrates legacy keychain entries and clears legacy slots', () => {
    setLegacyProviderSecret('deepseek', 'api-key', 'ds-key');

    const synced = migratePiProviderCredentialsToKeychain(
      secretStorage,
      ['anthropic'],
      'DEEPSEEK_API_KEY=legacy\nPI_ENABLE_EXA=1',
    );

    expect(synced.changed).toBe(true);
    expect(synced.addedProviders).toContain('deepseek');
    expect(synced.environmentVariables).not.toContain('legacy');
    expect(secretStorage.getSecret(getProviderCredentialSecretId('deepseek', 'api-key'))).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('deepseek'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'legacy' }),
    );
  });

  it('hard-migrates credential-v2 entries into unversioned credential entries', () => {
    secretStorage.setSecret(
      'pivi-anthropic-credential-v2',
      JSON.stringify({ type: 'api-key', key: 'sk-v2' }),
    );

    const synced = migratePiProviderCredentialsToKeychain(secretStorage, [], '');

    expect(synced.changed).toBe(true);
    expect(synced.addedProviders).toEqual(['anthropic']);
    expect(secretStorage.getSecret('pivi-anthropic-credential-v2')).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'sk-v2' }),
    );
  });

  it('tracks disabled provider ids', () => {
    expect(isProviderDisabled(['anthropic'], 'anthropic')).toBe(true);
    expect(isProviderDisabled(['anthropic'], 'openai')).toBe(false);
  });

  it('writes provider-scoped pi-ai credentials and clears legacy entries', async () => {
    setLegacyProviderSecret('anthropic', 'api-key', 'sk-legacy');
    const store = new ObsidianCredentialStore(secretStorage);

    await store.modify('anthropic', async () => ({ type: 'api-key', key: 'sk-new' }));

    expect(secretStorage.getSecret(getProviderCredentialSecretId('anthropic', 'api-key'))).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'sk-new' }),
    );
    expect(store.listProviderIdsSync()).toEqual(['anthropic']);
  });

  it('serializes pi-ai credential store modify calls by provider id', async () => {
    const store = new ObsidianCredentialStore(secretStorage);
    const seen: Array<string | undefined> = [];

    await Promise.all([
      store.modify('anthropic', async (current) => {
        seen.push(credentialToApiKey(current));
        await Promise.resolve();
        return { type: 'api-key', key: 'first' };
      }),
      store.modify('anthropic', async (current) => {
        seen.push(credentialToApiKey(current));
        return { type: 'api-key', key: 'second' };
      }),
    ]);

    expect(seen).toEqual([undefined, 'first']);
    expect(credentialToApiKey(store.readSync('anthropic'))).toBe('second');
  });
});
