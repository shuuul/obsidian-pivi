/**
 * Spec 031 environment migration and two-device acceptance coverage.
 */

import { createWebSearchCredentialStore } from '@pivi/agent/tools/webSearch/credentialStore';
import type { SyncSecretStore } from '@pivi/agent/ports';
import type { DeviceLocalEnvironmentStateV1 } from '@pivi/agent/settings/deviceLocalEnvironmentState';
import {
  buildEntriesFromLegacyText,
  createEmptyDeviceLocalEnvironmentState,
  hasPersistedEnvironmentFields,
  stageEnvironmentSecrets,
} from '@pivi/agent/settings/deviceLocalEnvironmentState';

import { loadDeviceLocalEnvironmentState } from '@/app/settings/deviceLocalEnvironmentLoad';

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

describe('device-local environment startup load', () => {
  it('does not migrate environment text synced by a release older than 0.15.0', async () => {
    const secrets = createMemorySecretStore();
    const environmentStore = createEnvironmentStore();
    let saved: Record<string, unknown> | null = null;

    const result = await loadDeviceLocalEnvironmentState({
      app: { secretStorage: secrets } as never,
      rawSettings: {
        sharedEnvironmentVariables: 'PATH=/bin\nANTHROPIC_API_KEY=sk-a',
        agentSettings: {
          environmentVariables: 'PI_FLAG=1',
          addedProviders: ['anthropic'],
          visibleModels: [],
        },
      },
      environmentStore,
      savePersistedSettings: async (stored) => {
        saved = stored;
      },
    });

    expect(result.seededEmpty).toBe(true);
    expect(environmentStore.getState()).toEqual(createEmptyDeviceLocalEnvironmentState());
    expect(secrets.snapshot()).toEqual({});
    expect(saved).not.toBeNull();
    expect(hasPersistedEnvironmentFields(saved!)).toBe(false);
  });

  it('keeps independent registries for two simulated devices', async () => {
    const secretsA = createMemorySecretStore();
    const stateA = stageEnvironmentSecrets(
      secretsA,
      buildEntriesFromLegacyText('PATH=/device-a', ''),
      null,
    ).nextState;
    const storeA = createEnvironmentStore(stateA);
    const storeB = createEnvironmentStore();
    const synced = { agentSettings: { addedProviders: [], visibleModels: [] } };

    const resultA = await loadDeviceLocalEnvironmentState({
      app: { secretStorage: secretsA } as never,
      rawSettings: synced,
      environmentStore: storeA,
      savePersistedSettings: async () => undefined,
      getSystemEnvironmentVariable: () => undefined,
    });
    const resultB = await loadDeviceLocalEnvironmentState({
      app: { secretStorage: createMemorySecretStore() } as never,
      rawSettings: synced,
      environmentStore: storeB,
      savePersistedSettings: async () => undefined,
    });

    expect(resultA.settings.sharedEnvironmentVariables).toContain('PATH=/device-a');
    expect(resultB.settings.sharedEnvironmentVariables ?? '').not.toContain('PATH=/device-a');
    expect(storeB.getState()).toEqual(createEmptyDeviceLocalEnvironmentState());
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
        visibleModels: [],
      },
    };

    await loadDeviceLocalEnvironmentState({
      app: { secretStorage: secrets } as never,
      rawSettings,
      environmentStore,
      savePersistedSettings: async () => {
        saveCount += 1;
      },
    });
    const firstState = JSON.stringify(environmentStore.getState());

    const second = await loadDeviceLocalEnvironmentState({
      app: { secretStorage: secrets } as never,
      rawSettings: { agentSettings: { environmentVariables: '', addedProviders: [], visibleModels: [] } },
      environmentStore,
      savePersistedSettings: async () => {
        saveCount += 1;
      },
    });

    expect(JSON.stringify(environmentStore.getState())).toBe(firstState);
    expect(second.seededEmpty).toBe(false);
    expect(saveCount).toBe(1);
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
