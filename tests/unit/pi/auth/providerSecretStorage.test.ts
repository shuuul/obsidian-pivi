import { credentialToApiKey, getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import {
  createObsidianCredentialStore,
  migratePiProviderCredentialsToKeychain,
  ObsidianCredentialStore,
} from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  isProviderDisabled,
  isSecretStorageAvailable,
  parseProviderCredentialSecretId,
} from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';
import { createWebSearchCredentialStore, getWebSearchCredentialSecretId } from '@pivi/pivi-agent-core/tools';
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

    store.writeSync('anthropic', { type: 'api_key', key: 'sk-test' });

    expect(secretStorage.listSecrets()).toEqual([getPiAiCredentialSecretId('anthropic')]);
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api_key', key: 'sk-test' }),
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
      JSON.stringify({ type: 'api_key', key: 'sk-plain' }),
    );
    expect(new ObsidianCredentialStore(secretStorage).readSync('anthropic')).toEqual({
      type: 'api_key',
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
      JSON.stringify({ type: 'api_key', key: 'legacy' }),
    );
  });

  it('hard-migrates credential-v2 entries into unversioned credential entries', () => {
    secretStorage.setSecret(
      'pivi-anthropic-credential-v2',
      JSON.stringify({ type: 'api_key', key: 'sk-v2' }),
    );

    const synced = migratePiProviderCredentialsToKeychain(secretStorage, [], '');

    expect(synced.changed).toBe(true);
    expect(synced.addedProviders).toEqual(['anthropic']);
    expect(secretStorage.getSecret('pivi-anthropic-credential-v2')).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api_key', key: 'sk-v2' }),
    );
  });

  it('ignores WebSearch credentials when migrating Pi provider credentials', () => {
    const exaEnvLine = `${'EXA'}_API_KEY=web-env`;
    createWebSearchCredentialStore(secretStorage)!.writeSync('tavily', 'tavily-key');
    secretStorage.setSecret(
      getPiAiCredentialSecretId('exa'),
      JSON.stringify({ type: 'api_key', key: 'legacy-web-exa' }),
    );

    const synced = migratePiProviderCredentialsToKeychain(
      secretStorage,
      ['anthropic', 'exa'],
      `ANTHROPIC_API_KEY=sk-plain\n${exaEnvLine}`,
    );

    expect(synced.addedProviders).toEqual(['anthropic']);
    expect(synced.environmentVariables).toBe(exaEnvLine);
    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('tavily'))).toBe('tavily-key');
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('exa'))).toBe(
      JSON.stringify({ type: 'api_key', key: 'legacy-web-exa' }),
    );
  });

  it('stores WebSearch credentials independently from Pi provider credentials', () => {
    const store = createWebSearchCredentialStore(secretStorage)!;

    store.writeSync('exa', ' exa-key ');
    store.writeSync('tavily', 'tavily-key');
    store.writeSync('exa', 'exa-key-2');

    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('exa'))).toBe('exa-key-2');
    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('tavily'))).toBe('tavily-key');
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('exa'))).toBeNull();

    store.clearSync('exa');

    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('exa'))).toBeNull();
    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('tavily'))).toBe('tavily-key');
  });

  it('writes only the selected WebSearch provider secret', () => {
    const writes: string[] = [];
    const secrets = new Map<string, string>();
    const store = createWebSearchCredentialStore({
      getSecret: (key) => secrets.get(key) ?? null,
      setSecret: (key, value) => {
        writes.push(key);
        if (value === '') {
          secrets.delete(key);
          return;
        }
        secrets.set(key, value);
      },
      listSecrets: () => [...secrets.keys()],
    })!;

    store.writeSync('exa', 'exa-key');
    store.writeSync('tavily', 'tavily-key');
    writes.length = 0;

    store.writeSync('exa', 'exa-key-2');

    expect(writes).toEqual([getWebSearchCredentialSecretId('exa')]);
    expect(secrets.get(getWebSearchCredentialSecretId('tavily'))).toBe('tavily-key');
  });

  it('marks unsupported added-provider cleanup as a settings change', () => {
    secretStorage.setSecret(
      getPiAiCredentialSecretId('anthropic'),
      JSON.stringify({ type: 'api_key', key: 'sk-test' }),
    );

    const synced = migratePiProviderCredentialsToKeychain(secretStorage, ['exa'], '');

    expect(synced.changed).toBe(true);
    expect(synced.addedProviders).toEqual(['anthropic']);
  });

  it('tracks disabled provider ids', () => {
    expect(isProviderDisabled(['anthropic'], 'anthropic')).toBe(true);
    expect(isProviderDisabled(['anthropic'], 'openai')).toBe(false);
  });

  it('writes provider-scoped pi-ai credentials and clears legacy entries', async () => {
    setLegacyProviderSecret('anthropic', 'api-key', 'sk-legacy');
    const store = new ObsidianCredentialStore(secretStorage);

    await store.modify('anthropic', async () => ({ type: 'api_key', key: 'sk-new' }));

    expect(secretStorage.getSecret(getProviderCredentialSecretId('anthropic', 'api-key'))).toBeNull();
    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toBe(
      JSON.stringify({ type: 'api_key', key: 'sk-new' }),
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
        return { type: 'api_key', key: 'first' };
      }),
      store.modify('anthropic', async (current) => {
        seen.push(credentialToApiKey(current));
        return { type: 'api_key', key: 'second' };
      }),
    ]);

    expect(seen).toEqual([undefined, 'first']);
    expect(credentialToApiKey(store.readSync('anthropic'))).toBe('second');
  });
});

describe('ObsidianCredentialStore over SyncSecretStore', () => {
  function createInMemorySyncSecretStore(): SyncSecretStore {
    const secrets = new Map<string, string>();
    return {
      getSecret: (key) => secrets.get(key) ?? null,
      setSecret: (key, value) => {
        if (value === '') {
          secrets.delete(key);
        } else {
          secrets.set(key, value);
        }
      },
      listSecrets: (prefix?: string) => {
        const keys = [...secrets.keys()];
        return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
      },
      deleteSecret: (key) => {
        secrets.delete(key);
      },
    };
  }

  it('reads and lists credentials without Obsidian SecretStorage', async () => {
    const secretStorage = createInMemorySyncSecretStore();
    const store = new ObsidianCredentialStore(secretStorage);

    store.writeSync('openai', { type: 'api_key', key: 'sk-openai' });
    store.writeSync('anthropic', { type: 'api_key', key: 'sk-anthropic' });

    expect(store.readSync('openai')).toEqual({ type: 'api_key', key: 'sk-openai' });
    expect(await store.read('anthropic')).toEqual({ type: 'api_key', key: 'sk-anthropic' });
    expect(store.listProviderIdsSync()).toEqual(['anthropic', 'openai']);
  });

  it('clears stale migrated provider secrets when writing a canonical credential', () => {
    const secretStorage = createInMemorySyncSecretStore();
    secretStorage.setSecret(getProviderCredentialSecretId('anthropic', 'api-key'), 'sk-legacy-slot');
    secretStorage.setSecret('pivi-anthropic-credential-v2', JSON.stringify({ type: 'api_key', key: 'sk-v2' }));

    const store = new ObsidianCredentialStore(secretStorage);
    store.writeSync('anthropic', { type: 'api_key', key: 'sk-canonical' });

    expect(secretStorage.getSecret(getProviderCredentialSecretId('anthropic', 'api-key'))).toBeNull();
    expect(secretStorage.getSecret('pivi-anthropic-credential-v2')).toBeNull();
    expect(store.readSync('anthropic')).toEqual({ type: 'api_key', key: 'sk-canonical' });
    expect(secretStorage.listSecrets()).toEqual([getPiAiCredentialSecretId('anthropic')]);
  });

  it('clearSync drops the provider from listProviderIdsSync', async () => {
    const secretStorage = createInMemorySyncSecretStore();
    const store = new ObsidianCredentialStore(secretStorage);
    store.writeSync('anthropic', { type: 'api_key', key: 'sk-test' });

    await store.delete('anthropic');

    expect(store.readSync('anthropic')).toBeUndefined();
    expect(store.listProviderIdsSync()).toEqual([]);
  });

  it('createObsidianCredentialStore accepts a SyncSecretStore port implementation', () => {
    const secretStorage = createInMemorySyncSecretStore();
    const store = createObsidianCredentialStore(secretStorage);

    expect(store).not.toBeNull();
    store!.writeSync('deepseek', { type: 'api_key', key: 'ds-key' });
    expect(store!.readSync('deepseek')).toEqual({ type: 'api_key', key: 'ds-key' });
  });
});

describe('isSecretStorageAvailable', () => {
  function createSyncSecretStore(
    overrides: Partial<SyncSecretStore> = {},
  ): SyncSecretStore {
    const secrets = new Map<string, string>();
    return {
      getSecret: (key) => secrets.get(key) ?? null,
      setSecret: (key, value) => {
        secrets.set(key, value);
      },
      listSecrets: (prefix?: string) => {
        const keys = [...secrets.keys()];
        return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
      },
      ...overrides,
    };
  }

  it.each([
    { name: 'undefined', value: undefined },
    { name: 'null', value: null },
    { name: 'empty object', value: {} },
    { name: 'missing getSecret', value: { setSecret: () => {}, listSecrets: () => [] } },
    { name: 'missing setSecret', value: { getSecret: (): string | null => null, listSecrets: () => [] } },
    { name: 'missing listSecrets', value: { getSecret: (): string | null => null, setSecret: () => {} } },
  ])('rejects incomplete secret storage ($name)', ({ value }) => {
    expect(isSecretStorageAvailable(value as SyncSecretStore | undefined)).toBe(false);
  });

  it('accepts Obsidian-like sync secret stores with optional listSecrets prefix', () => {
    const store = createSyncSecretStore();
    expect(isSecretStorageAvailable(store)).toBe(true);
    store.setSecret('pivi-openai-api-key', 'sk-test');
    expect(store.listSecrets('pivi-')).toEqual(['pivi-openai-api-key']);
  });
});

describe('getProviderCredentialSecret', () => {
  function storeWithSecret(providerId: string, kind: 'api-key' | 'oauth-token', secret: string): SyncSecretStore {
    const key = getProviderCredentialSecretId(providerId, kind);
    return {
      getSecret: (id: string): string | null => (id === key ? secret : null),
      setSecret: () => {},
      listSecrets: () => [key],
    };
  }

  it.each([
    { name: 'empty string', secret: '' },
    { name: 'absent key', secret: null as unknown as string, absent: true },
  ])('treats $name as absent', ({ secret, absent }) => {
    const store: SyncSecretStore = absent
      ? {
          getSecret: (): string | null => null,
          setSecret: () => {},
          listSecrets: () => [],
        }
      : storeWithSecret('anthropic', 'api-key', secret);
    expect(getProviderCredentialSecret(store, 'anthropic', 'api-key')).toBeNull();
  });

  it('returns non-empty stored secrets', () => {
    const store = storeWithSecret('anthropic', 'oauth-token', 'oauth-secret');
    expect(getProviderCredentialSecret(store, 'anthropic', 'oauth-token')).toBe('oauth-secret');
  });
});
