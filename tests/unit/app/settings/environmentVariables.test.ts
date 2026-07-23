import { getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/engine/pi';
import type { OpenSessionState, PiviSettings } from '@pivi/pivi-agent-core/foundation';
import { getEnvironmentSecretId } from '@pivi/pivi-agent-core/foundation/configValueSource';
import type { DeviceLocalEnvironmentStateV1 } from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';
import { getWebSearchCredentialSecretId } from '@pivi/pivi-agent-core/tools/webSearch/credentialStore';

import type { PiviChatView, PiviChatViewMaintenance } from '@/app/hostContracts';
import {
  applyEnvironmentVariablesBatch,
  importEnvironmentText,
} from '@/app/settings/environmentVariables';

function createMemorySecretStore(): SyncSecretStore {
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
  };
}

function createView(maintenance: Partial<PiviChatViewMaintenance>): PiviChatView {
  return {
    leaf: {} as never,
    getChatHandle: () => ({
      commands: {} as never,
      maintenance: maintenance as PiviChatViewMaintenance,
    }),
  };
}

function createHost(options: {
  settings: PiviSettings;
  views: PiviChatView[];
  notify?: jest.Mock;
  saveSettings?: jest.Mock;
  environmentStore?: ReturnType<typeof createEnvironmentStore>;
  secretStorage?: SyncSecretStore;
}) {
  return {
    settings: options.settings,
    saveSettings: options.saveSettings ?? jest.fn(async () => undefined),
    getAllViews: () => options.views,
    notify: options.notify ?? jest.fn(),
    app: {
      secretStorage: options.secretStorage ?? createMemorySecretStore(),
    },
    getEnvironmentStore: () => options.environmentStore ?? createEnvironmentStore(),
  };
}

describe('environment variable runtime propagation', () => {
  it('hands canonical provider and web keys to credential stores before publishing the registry', async () => {
    const secretStorage = createMemorySecretStore();
    secretStorage.setSecret(getWebSearchCredentialSecretId('brave'), 'brave-old');
    const environmentStore = createEnvironmentStore();
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '', addedProviders: ['anthropic'] },
    } as unknown as PiviSettings;

    await importEnvironmentText(
      createHost({ settings, views: [], secretStorage, environmentStore }),
      'shared',
      'ANTHROPIC_API_KEY=sk-next\nBRAVE_API_KEY=brave-next\nPATH=/bin',
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({ changed: false, invalidatedSessions: [] }),
      },
    );

    expect(secretStorage.getSecret(getPiAiCredentialSecretId('anthropic'))).toContain('sk-next');
    expect(secretStorage.getSecret(getWebSearchCredentialSecretId('brave'))).toBe('brave-next');
    expect(environmentStore.loadInitialized()?.entries.map(entry => entry.key)).toEqual(['PATH']);
  });

  it('preflights every scope before changing credentials or publishing', async () => {
    const secretStorage = createMemorySecretStore();
    const providerId = getPiAiCredentialSecretId('anthropic');
    secretStorage.setSecret(providerId, 'old-provider');
    const environmentStore = createEnvironmentStore();
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '', addedProviders: ['anthropic'] },
    } as unknown as PiviSettings;

    await expect(applyEnvironmentVariablesBatch(
      createHost({ settings, views: [], secretStorage, environmentStore }),
      [
        { scope: 'shared', envText: 'ANTHROPIC_API_KEY=next' },
        { scope: 'agent', envText: 'OPENAI_API_KEY=unconfigured' },
      ],
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({ changed: false, invalidatedSessions: [] }),
      },
    )).rejects.toThrow('provider is not configured');

    expect(secretStorage.getSecret(providerId)).toBe('old-provider');
    expect(environmentStore.loadInitialized()).toBeNull();
  });

  it('rolls canonical credentials back when publication fails', async () => {
    const secretStorage = createMemorySecretStore();
    const webId = getWebSearchCredentialSecretId('brave');
    secretStorage.setSecret(webId, 'brave-old');
    const environmentStore = createEnvironmentStore();
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '', addedProviders: [] },
    } as unknown as PiviSettings;

    await expect(importEnvironmentText(
      createHost({
        settings,
        views: [],
        secretStorage,
        environmentStore,
        saveSettings: jest.fn(async () => { throw new Error('save failed'); }),
      }),
      'shared',
      'BRAVE_API_KEY=brave-next\nPATH=/bin',
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({ changed: false, invalidatedSessions: [] }),
      },
    )).rejects.toThrow('save failed');

    expect(secretStorage.getSecret(webId)).toBe('brave-old');
  });

  it('continues the serialized queue after a rejected operation', async () => {
    const environmentStore = createEnvironmentStore();
    const host = createHost({
      settings: {
        sharedEnvironmentVariables: '',
        agentSettings: { environmentVariables: '', addedProviders: [] },
      } as unknown as PiviSettings,
      views: [],
      environmentStore,
    });
    const hooks = {
      persistSessionSummary: jest.fn(async () => undefined),
      reconcileModelWithEnvironment: () => ({ changed: false, invalidatedSessions: [] }),
    };

    const rejected = importEnvironmentText(host, 'shared', 'OPENAI_API_KEY=nope', hooks);
    const accepted = importEnvironmentText(host, 'shared', 'PATH=/after', hooks);
    await expect(rejected).rejects.toThrow('provider is not configured');
    await expect(accepted).resolves.toBeUndefined();
    expect(environmentStore.loadInitialized()?.entries).toEqual([
      { key: 'PATH', scope: 'shared', source: { kind: 'plain', value: '/after' } },
    ]);
  });

  it('preserves untouched secret and system source references during a partial batch', async () => {
    const secretStorage = createMemorySecretStore();
    secretStorage.setSecret(getEnvironmentSecretId('agent', 'TOKEN'), 'hidden');
    const environmentStore = createEnvironmentStore({
      version: 1,
      initialized: true,
      entries: [
        { key: 'PATH', scope: 'shared', source: { kind: 'plain', value: '/old' } },
        { key: 'TOKEN', scope: 'agent', source: { kind: 'secret' } },
        { key: 'HOME_REF', scope: 'agent', source: { kind: 'systemEnvironment', name: 'HOME' } },
      ],
    });
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '', addedProviders: [] },
    } as unknown as PiviSettings;

    await applyEnvironmentVariablesBatch(
      createHost({ settings, views: [], secretStorage, environmentStore }),
      [{ scope: 'shared', envText: 'PATH=/new' }],
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({ changed: false, invalidatedSessions: [] }),
      },
    );

    expect(environmentStore.loadInitialized()?.entries.filter(entry => entry.scope === 'agent'))
      .toEqual([
        { key: 'TOKEN', scope: 'agent', source: { kind: 'secret' } },
        { key: 'HOME_REF', scope: 'agent', source: { kind: 'systemEnvironment', name: 'HOME' } },
      ]);
  });

  it('uses semantic view maintenance and reports failed tab restarts', async () => {
    const applyEnvironmentRuntimeChange = jest.fn(async () => ({ failedTabs: 2 }));
    const invalidateSlashCatalog = jest.fn();
    const refreshModelPresentation = jest.fn();
    const view = createView({
      applyEnvironmentRuntimeChange,
      invalidateSlashCatalog,
      refreshModelPresentation,
    });
    const notify = jest.fn();
    const saveSettings = jest.fn(async () => undefined);
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '' },
    } as unknown as PiviSettings;
    const invalidatedSession = {
      id: 'session-1',
      sessionFile: '.pivi/sessions/one.jsonl',
    } as OpenSessionState;
    const persistSessionSummary = jest.fn(async () => undefined);

    await applyEnvironmentVariablesBatch(
      createHost({ settings, views: [view], notify, saveSettings }),
      [{ scope: 'shared', envText: 'PATH=/next' }],
      {
        persistSessionSummary,
        reconcileModelWithEnvironment: () => ({
          changed: true,
          invalidatedSessions: [invalidatedSession],
        }),
      },
    );

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(persistSessionSummary).toHaveBeenCalledWith(invalidatedSession);
    expect(applyEnvironmentRuntimeChange).toHaveBeenCalledWith(true);
    expect(invalidateSlashCatalog).toHaveBeenCalledTimes(1);
    expect(refreshModelPresentation).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenNthCalledWith(
      1,
      'Environment changes applied, but 2 affected tab(s) failed to restart.',
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      'Environment variables applied. Sessions will be rebuilt on next message.',
    );
  });

  it('propagates environment changes and presentation refreshes to every open view', async () => {
    const firstViewRuntimeChange = jest.fn(async () => ({ failedTabs: 1 }));
    const firstViewInvalidateSlashCatalog = jest.fn();
    const firstViewRefreshModelPresentation = jest.fn();
    const secondViewRuntimeChange = jest.fn(async () => ({ failedTabs: 2 }));
    const secondViewInvalidateSlashCatalog = jest.fn();
    const secondViewRefreshModelPresentation = jest.fn();
    const views = [
      createView({
        applyEnvironmentRuntimeChange: firstViewRuntimeChange,
        invalidateSlashCatalog: firstViewInvalidateSlashCatalog,
        refreshModelPresentation: firstViewRefreshModelPresentation,
      }),
      createView({
        applyEnvironmentRuntimeChange: secondViewRuntimeChange,
        invalidateSlashCatalog: secondViewInvalidateSlashCatalog,
        refreshModelPresentation: secondViewRefreshModelPresentation,
      }),
    ];
    const notify = jest.fn();
    const settings = {
      sharedEnvironmentVariables: '',
      agentSettings: { environmentVariables: '' },
    } as unknown as PiviSettings;

    await applyEnvironmentVariablesBatch(
      createHost({ settings, views, notify }),
      [{ scope: 'agent', envText: 'PI_FLAG=next' }],
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({
          changed: true,
          invalidatedSessions: [],
        }),
      },
    );

    expect(firstViewRuntimeChange).toHaveBeenCalledTimes(1);
    expect(firstViewRuntimeChange).toHaveBeenCalledWith(true);
    expect(secondViewRuntimeChange).toHaveBeenCalledTimes(1);
    expect(secondViewRuntimeChange).toHaveBeenCalledWith(true);
    expect(firstViewInvalidateSlashCatalog).toHaveBeenCalledTimes(1);
    expect(secondViewInvalidateSlashCatalog).toHaveBeenCalledTimes(1);
    expect(firstViewRefreshModelPresentation).toHaveBeenCalledTimes(1);
    expect(secondViewRefreshModelPresentation).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenNthCalledWith(
      1,
      'Environment changes applied, but 3 affected tab(s) failed to restart.',
    );
  });

  it('does not restart chat runtimes when environment values are unchanged', async () => {
    const applyEnvironmentRuntimeChange = jest.fn(async () => ({ failedTabs: 0 }));
    const view = createView({
      applyEnvironmentRuntimeChange,
      invalidateSlashCatalog: jest.fn(),
      refreshModelPresentation: jest.fn(),
    });
    const environmentStore = createEnvironmentStore({
      version: 1,
      initialized: true,
      entries: [
        { key: 'PATH', scope: 'shared', source: { kind: 'plain', value: '/same' } },
      ],
    });
    const settings = {
      sharedEnvironmentVariables: 'PATH=/same',
      agentSettings: { environmentVariables: '' },
    } as unknown as PiviSettings;

    await applyEnvironmentVariablesBatch(
      createHost({ settings, views: [view], environmentStore }),
      [{ scope: 'shared', envText: 'PATH=/same' }],
      {
        persistSessionSummary: jest.fn(async () => undefined),
        reconcileModelWithEnvironment: () => ({
          changed: false,
          invalidatedSessions: [],
        }),
      },
    );

    expect(applyEnvironmentRuntimeChange).not.toHaveBeenCalled();
  });
});
