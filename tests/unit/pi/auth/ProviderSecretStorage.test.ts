import { getProviderEnvVarNames } from '../../../../src/pi/auth/providerEnvVars';
import {
  credentialToApiKey,
  getPiAiCredentialSecretId,
  ObsidianCredentialStore,
} from '../../../../src/pi/auth/ObsidianCredentialStore';
import {
  getProviderCredentialSecretId,
  isProviderConfigured,
  isProviderDisabled,
  listProviderIdsWithKeychainSecrets,
  migratePlaintextProviderSecretsToKeychain,
  parseProviderCredentialSecretId,
  resolveProviderCredentialFromKeychain,
  setProviderCredentialSecret,
  syncPiProvidersFromKeychain,
} from '../../../../src/pi/auth/ProviderSecretStorage';
import { SecretStorage } from 'obsidian';

describe('ProviderSecretStorage', () => {
  let secretStorage: SecretStorage;

  beforeEach(() => {
    secretStorage = new SecretStorage();
  });

  it('builds stable secret ids per provider', () => {
    expect(getProviderCredentialSecretId('anthropic', 'api-key')).toBe('obsius2-anthropic-api-key');
    expect(parseProviderCredentialSecretId('obsius2-openai-api-key')).toEqual({
      providerId: 'openai',
      kind: 'api-key',
    });
  });

  it('stores and resolves credentials from keychain', () => {
    setProviderCredentialSecret(secretStorage, 'anthropic', 'api-key', 'sk-test');
    expect(resolveProviderCredentialFromKeychain(secretStorage, 'anthropic')).toBe('sk-test');
    expect(listProviderIdsWithKeychainSecrets(secretStorage)).toEqual(['anthropic']);
  });

  it('migrates plaintext env values into keychain', () => {
    const env = 'ANTHROPIC_API_KEY=sk-plain\nPI_ENABLE_EXA=1';
    const result = migratePlaintextProviderSecretsToKeychain(
      secretStorage,
      'anthropic',
      env,
      getProviderEnvVarNames('anthropic'),
    );
    expect(result.changed).toBe(true);
    expect(result.environmentVariables).not.toContain('sk-plain');
    expect(resolveProviderCredentialFromKeychain(secretStorage, 'anthropic')).toBe('sk-plain');
  });

  it('syncs added providers from keychain and migrates plaintext', () => {
    setProviderCredentialSecret(secretStorage, 'deepseek', 'api-key', 'ds-key');
    const synced = syncPiProvidersFromKeychain(
      secretStorage,
      ['anthropic'],
      'DEEPSEEK_API_KEY=legacy\nPI_ENABLE_EXA=1',
    );
    expect(synced.changed).toBe(true);
    expect(synced.addedProviders).toContain('deepseek');
    expect(synced.environmentVariables).not.toContain('legacy');
  });

  it('treats disabled providers as not configured', () => {
    setProviderCredentialSecret(secretStorage, 'openai', 'api-key', 'sk');
    expect(
      isProviderConfigured(secretStorage, 'openai', '', {
        disabledProviders: ['openai'],
      }),
    ).toBe(false);
  });

  it('tracks disabled provider ids', () => {
    expect(isProviderDisabled(['anthropic'], 'anthropic')).toBe(true);
    expect(isProviderDisabled(['anthropic'], 'openai')).toBe(false);
  });

  it('reads legacy keychain entries through the pi-ai credential store', async () => {
    setProviderCredentialSecret(secretStorage, 'anthropic', 'api-key', 'sk-legacy');
    const store = new ObsidianCredentialStore(secretStorage);

    expect(await store.read('anthropic')).toEqual({ type: 'api-key', key: 'sk-legacy' });
    expect(credentialToApiKey(store.readSync('anthropic'))).toBe('sk-legacy');
  });

  it('writes provider-scoped pi-ai credentials and clears legacy entries', async () => {
    setProviderCredentialSecret(secretStorage, 'anthropic', 'api-key', 'sk-legacy');
    const store = new ObsidianCredentialStore(secretStorage);

    await store.modify('anthropic', async () => ({ type: 'api-key', key: 'sk-v2' }));

    expect(secretStorage.getSecret(getProviderCredentialSecretId('anthropic', 'api-key'))).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api-key', key: 'sk-v2' }),
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
