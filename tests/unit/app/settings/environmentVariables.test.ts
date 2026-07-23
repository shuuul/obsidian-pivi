import type { OpenSessionState, PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { DeviceLocalEnvironmentStateV1 } from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';

import type { PiviChatView, PiviChatViewMaintenance } from '@/app/hostContracts';
import { applyEnvironmentVariablesBatch } from '@/app/settings/environmentVariables';

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
