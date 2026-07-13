import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';

import type {
  PiviChatHost,
  PiviSettingsHost,
  PiviUiFacades,
} from '@/app/hostContracts';
import { createInlineEditPort } from '@/app/ui/createInlineEditPort';
import {
  createChatUiPorts,
  createSettingsUiPorts,
} from '@/app/ui/createUiPorts';

function createUiFacades(): PiviUiFacades {
  return {
    chatUIConfig: {} as PiviUiFacades['chatUIConfig'],
    getSettingsSnapshot: settings => ({ ...settings }),
    commitSettingsSnapshot: (settings, snapshot) => Object.assign(settings, snapshot),
    listModelsForProvider: () => [],
    syncCustomProviders: () => {},
    fetchCustomProviderModels: async () => ({ count: 0 }),
    migrateProviderCredentialsToKeychain: (_storage, addedProviders, environmentVariables) => ({
      addedProviders: [...addedProviders],
      environmentVariables,
      changed: false,
    }),
  };
}

describe('UI port adapters', () => {
  it('projects chat capabilities without exposing the raw host or workspace', async () => {
    const chatService = { id: 'chat-service' };
    const auxRunner = { id: 'aux-runner' };
    const listTools = jest.fn(async () => [{ name: 'search' }]);
    const getDropdownConfig = jest.fn(() => ({
      triggerChars: ['/'],
      builtInPrefix: '',
      skillPrefix: '',
      commandPrefix: '',
    }));
    const host = {
      settings: {} as PiviSettings,
      saveSettings: async () => {},
      getUiFacades: () => createUiFacades(),
      createChatService: () => chatService,
      createAuxQueryRunner: () => auxRunner,
      getSessionList: () => [],
      getOpenSessionById: async () => null,
      createOpenSession: async () => ({ id: 'open-session' }),
      openSessionByFile: async () => ({ id: 'open-session' }),
      deleteSession: async () => {},
      renameSession: async () => {},
      updateSession: async () => {},
      listSessionLeaves: async () => [],
      forkSessionAt: async () => null,
      getPiWorkspace: () => ({
        mcpServerManager: {
          getServers: () => [],
          getContextSavingServers: () => [],
        },
        mcpToolProvider: { listTools },
        skillProvider: { listSkills: () => [] },
        slashCommandCatalog: {
          listDropdownEntries: async () => [],
          getDropdownConfig,
          refresh: async () => {},
        },
        modelReadinessProvider: {
          getStatus: () => ({ kind: 'ready', label: 'Ready', description: '' }),
          testModel: async () => ({ ok: true, detail: 'ok' }),
        },
      }),
    } as unknown as PiviChatHost & Pick<PiviSettingsHost, 'getPiWorkspace'>;

    const ports = createChatUiPorts(host);

    expect(ports.runtime.createChatService()).toBe(chatService);
    expect(createInlineEditPort(host).createAuxQueryRunner()).toBe(auxRunner);
    await expect(ports.catalog.listMcpTools('server')).resolves.toEqual([{ name: 'search' }]);
    expect(ports.catalog.getSlashDropdownConfig()).toEqual({
      triggerChars: ['/'],
      builtInPrefix: '',
      skillPrefix: '',
      commandPrefix: '',
    });
    expect(ports.models.getReadinessProvider()?.getStatus('model', {})).toEqual({
      kind: 'ready',
      label: 'Ready',
      description: '',
    });
    expect(getDropdownConfig).toHaveBeenCalled();
    expect(ports).not.toHaveProperty('configuration');
    expect(ports).not.toHaveProperty('plugin');
    expect(ports).not.toHaveProperty('workspace');
    expect(ports).not.toHaveProperty('getPiWorkspace');
  });

  it('projects settings persistence and environment actions', async () => {
    const applyEnvironmentVariables = jest.fn(async () => {});
    const host = {
      settings: {} as PiviSettings,
      saveSettings: async () => {},
      getUiFacades: () => createUiFacades(),
      getActiveEnvironmentVariables: () => 'ACTIVE=1',
      getEnvironmentVariablesForScope: () => 'SCOPE=1',
      applyEnvironmentVariables,
      applyEnvironmentVariablesBatch: async () => {},
    } as unknown as PiviSettingsHost;

    const ports = createSettingsUiPorts(host);

    expect(ports.environment.getActiveEnvironmentVariables()).toBe('ACTIVE=1');
    expect(ports.environment.getEnvironmentVariables('agent')).toBe('SCOPE=1');
    await ports.environment.applyEnvironmentVariables('agent', 'NEXT=1');
    expect(applyEnvironmentVariables).toHaveBeenCalledWith('agent', 'NEXT=1');
    expect(ports).not.toHaveProperty('plugin');
    expect(ports).not.toHaveProperty('storage');
  });
});
