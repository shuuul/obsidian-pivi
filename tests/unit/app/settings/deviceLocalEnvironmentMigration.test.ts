/**
 * Spec 031 environment migration and two-device acceptance coverage.
 */

import { createWebSearchCredentialStore } from '@pivi/pivi-agent-core/tools/webSearch/credentialStore';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';
import type { DeviceLocalEnvironmentStateV1 } from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import {
  createEmptyDeviceLocalEnvironmentState,
  hasPersistedEnvironmentFields,
  stripEnvironmentFieldsFromPersistedSettings,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import { getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { getWebSearchCredentialSecretId } from '@pivi/pivi-agent-core/tools/webSearch/credentialStore';

import { runDeviceLocalEnvironmentMigration } from '@/app/settings/deviceLocalEnvironmentMigration';

function createMemorySecretStore(): SyncSecretStore & { snapshot(): Record<string, string> } {
  const secrets = new Map<string, string>();
  return {
    getSecret(key) {
      return secrets.get(key) ?? null;
    },
    setSecret(key, value) {
      if (!value) {
        secrets.delete(key);
        return;
      }
      secrets.set(key, value);
    },
    listSecrets(prefix) {
      return [...secrets.keys()].filter((key) => !prefix || key.startsWith(prefix));
    },
    deleteSecret(key) {
      secrets.delete(key);
    },
    snapshot() {
      return Object.fromEntries(secrets.entries());
    },
  };
}

function createEnvironmentStore(initial: DeviceLocalEnvironmentStateV1 | null = null) {
  let state = initial;
  return {
    loadInitialized: () => state,
    isInitialized: () => state !== null,
    save(next: DeviceLocalEnvironmentStateV1) {
      state = next;
    },
    getState: () => state,
  };
}

describe('deviceLocalEnvironmentMigration', () => {
  it('migrates plaintext env to device-local registry and strips synced fields', async () => {
    const secrets = createMemorySecretStore();
    const environmentStore = createEnvironmentStore();
    let saved: Record<string, unknown> | null = null;
    const rawSettings = {
      sharedEnvironmentVariables: 'PATH=/bin\nCUSTOM_TOKEN=sekrit\nANTHROPIC_API_KEY=sk-a\nBRAVE_API_KEY=brave-key',
      agentSettings: {
        environmentVariables: 'PI_FLAG=1',
        addedProviders: ['anthropic'],
        selectedMode: 'default',
        visibleModels: [],
      },
    };

    const result = await runDeviceLocalEnvironmentMigration({
      app: { secretStorage: secrets } as never,
      rawSettings,
      environmentStore,
      savePersistedSettings: async (stored) => {
        saved = stored;
      },
    });

    expect(result.cutoverPerformed).toBe(true);
    expect(result.credentialsMigrated).toBe(true);
    expect(environmentStore.getState()?.entries.some((e) => e.key === 'PATH')).toBe(true);
    expect(environmentStore.getState()?.entries.some((e) => e.key === 'CUSTOM_TOKEN' && e.source.kind === 'secret')).toBe(true);
    expect(environmentStore.getState()?.entries.some((e) => e.key === 'ANTHROPIC_API_KEY')).toBe(false);
    expect(secrets.getSecret(getPiAiCredentialSecretId('anthropic'))).toContain('sk-a');
    expect(secrets.getSecret(getWebSearchCredentialSecretId('brave'))).toBe('brave-key');
    expect(saved).not.toBeNull();
    expect(hasPersistedEnvironmentFields(saved!)).toBe(false);
    expect(result.settings.sharedEnvironmentVariables).toContain('PATH=/bin');
    // Runtime projection may resolve secrets for consumers; local registry never stores the plaintext.
    const tokenEntry = environmentStore.getState()?.entries.find((e) => e.key === 'CUSTOM_TOKEN');
    expect(tokenEntry?.source).toEqual({ kind: 'secret' });
  });

  it('keeps independent registries for two simulated devices', async () => {
    const secretsA = createMemorySecretStore();
    const secretsB = createMemorySecretStore();
    const storeA = createEnvironmentStore();
    const storeB = createEnvironmentStore();
    const sharedRaw = {
      sharedEnvironmentVariables: 'PATH=/shared',
      agentSettings: {
        environmentVariables: '',
        addedProviders: [],
        selectedMode: 'default',
        visibleModels: [],
      },
    };

    await runDeviceLocalEnvironmentMigration({
      app: { secretStorage: secretsA } as never,
      rawSettings: sharedRaw,
      environmentStore: storeA,
      savePersistedSettings: async () => undefined,
      getSystemEnvironmentVariable: () => undefined,
    });
    // Device B starts fresh after A stripped synced env — simulate stripped portable settings.
    const portable: Record<string, unknown> = { ...sharedRaw };
    stripEnvironmentFieldsFromPersistedSettings(portable);

    await runDeviceLocalEnvironmentMigration({
      app: { secretStorage: secretsB } as never,
      rawSettings: portable,
      environmentStore: storeB,
      savePersistedSettings: async () => undefined,
    });

    expect(storeA.getState()?.entries.map((e) => e.key)).toContain('PATH');
    expect(storeB.getState()).toEqual(createEmptyDeviceLocalEnvironmentState());
    // Device A retained local PATH; device B has an independent empty registry after strip.
    expect(storeA.getState()).not.toEqual(storeB.getState());
  });

  it('is idempotent on a second load', async () => {
    const secrets = createMemorySecretStore();
    const environmentStore = createEnvironmentStore();
    let saveCount = 0;
    const rawSettings = {
      sharedEnvironmentVariables: 'PATH=/bin',
      agentSettings: {
        environmentVariables: '',
        addedProviders: [],
        selectedMode: 'default',
        visibleModels: [],
      },
    };

    await runDeviceLocalEnvironmentMigration({
      app: { secretStorage: secrets } as never,
      rawSettings,
      environmentStore,
      savePersistedSettings: async () => {
        saveCount += 1;
      },
    });
    const firstState = JSON.stringify(environmentStore.getState());

    const second = await runDeviceLocalEnvironmentMigration({
      app: { secretStorage: secrets } as never,
      rawSettings: { agentSettings: { environmentVariables: '', addedProviders: [], selectedMode: 'default', visibleModels: [] } },
      environmentStore,
      savePersistedSettings: async () => {
        saveCount += 1;
      },
    });

    expect(JSON.stringify(environmentStore.getState())).toBe(firstState);
    expect(second.cutoverPerformed).toBe(false);
    expect(saveCount).toBe(1);
  });

  it('leaves source authoritative when secret write fails', async () => {
    const failingSecrets: SyncSecretStore = {
      getSecret: () => null,
      setSecret: () => {
        throw new Error('secret write failed');
      },
      listSecrets: () => [],
    };
    const environmentStore = createEnvironmentStore();
    const rawSettings = {
      sharedEnvironmentVariables: 'MY_TOKEN=sekrit',
      agentSettings: {
        environmentVariables: '',
        addedProviders: [],
        selectedMode: 'default',
        visibleModels: [],
      },
    };

    await expect(runDeviceLocalEnvironmentMigration({
      app: { secretStorage: failingSecrets } as never,
      rawSettings,
      environmentStore,
      savePersistedSettings: async () => undefined,
    })).rejects.toThrow(/secret write failed/);
    expect(environmentStore.getState()).toBeNull();
    expect(hasPersistedEnvironmentFields(rawSettings)).toBe(true);
  });
});

describe('web credential store smoke', () => {
  it('creates a store over memory secrets', () => {
    const secrets = createMemorySecretStore();
    const store = createWebSearchCredentialStore(secrets);
    expect(store).not.toBeNull();
    store!.writeSync('tavily', 'tvly');
    expect(store!.readSync('tavily')).toBe('tvly');
  });
});
