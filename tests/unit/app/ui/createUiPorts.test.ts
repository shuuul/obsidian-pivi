import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';

import type {
  PiviSettingsHost,
  PiviUiFacades,
} from '@/app/hostContracts';
import { createInlineEditPort } from '@/app/ui/createInlineEditPort';
import {
  createChatUiPorts,
  createSettingsUiPorts,
} from '@/app/ui/createUiPorts';
import type { ChatUiCompositionHost } from '@/app/ui/createUiPorts';

function createUiFacades(): PiviUiFacades {
  return {
    chatUIConfig: {
      getModelOptions: () => [{ value: 'model-a', label: 'Model A' }],
      isAdaptiveReasoningModel: () => false,
      getReasoningOptions: () => [],
      getDefaultReasoningValue: () => 'medium',
      getContextWindowSize: () => 128_000,
      isDefaultModel: () => false,
      applyModelDefaults: (_model, settings) => {
        Object.assign(settings as object, { thinkingLevel: 'medium' });
      },
    },
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
  it('fails explicitly when a chat workspace capability is used before initialization', () => {
    const host = {
      settings: { ...DEFAULT_PIVI_SETTINGS } as PiviSettings,
      getUiFacades: () => createUiFacades(),
    } as unknown as ChatUiCompositionHost;

    const ports = createChatUiPorts(host, null);

    expect(() => ports.catalog.listMcpServers()).toThrow(
      'Pivi workspace services are not initialized.',
    );
  });

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
    const workspace = {
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
    };
    const saveSettings = jest.fn(async () => {});
    const uiFacades = createUiFacades();
    const getModelOptions = jest.fn(() => [{ value: 'model-a', label: 'Model A' }]);
    uiFacades.chatUIConfig.getModelOptions = getModelOptions;
    const host = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        model: 'model-a',
        thinkingBudget: 'medium',
        thinkingLevel: 'medium',
      } as PiviSettings,
      saveSettings,
      getAgentHostContext: () => ({}),
      getUiFacades: () => uiFacades,
      createChatService: () => chatService,
      createAuxQueryRunner: () => auxRunner,
      getSessionList: () => [],
      getOpenSessionSync: () => null,
      getOpenSessionById: async () => null,
      createOpenSession: async () => ({ id: 'open-session' }),
      openSessionByFile: async () => ({ id: 'open-session' }),
      deleteSession: async () => {},
      renameSession: async () => {},
      updateSession: async () => {},
      listSessionLeaves: async () => [],
      forkSessionAt: async () => null,
    } as unknown as ChatUiCompositionHost;

    const ports = createChatUiPorts(host, workspace as never);

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
    expect(ports.models.getModelOptions(ports.settings.getSettingsSnapshot())).toEqual([
      { value: 'model-a', label: 'Model A' },
    ]);
    const snapshot = ports.settings.getSettingsSnapshot();
    expect(snapshot).toEqual(expect.objectContaining({
      enableAutoScroll: true,
      enableAutoTitleGeneration: true,
      environmentVariables: expect.any(String),
      externalReadDirectories: expect.any(Array),
      hiddenSlashCommands: expect.any(Array),
      keyboardNavigation: expect.any(Object),
      modelCatalog: expect.objectContaining({
        addedProviders: expect.any(Array),
        disabledProviders: expect.any(Array),
        visibleModels: expect.any(Array),
        customProviders: expect.any(Array),
      }),
    }));
    expect(snapshot).not.toHaveProperty('agentSettings');
    expect(getModelOptions).toHaveBeenCalledWith(expect.objectContaining({
      agentSettings: expect.objectContaining({
        addedProviders: snapshot.modelCatalog.addedProviders,
        visibleModels: snapshot.modelCatalog.visibleModels,
        environmentVariables: snapshot.environmentVariables,
      }),
    }));
    snapshot.model = 'model-b';
    await ports.settings.commitSettingsSnapshot(snapshot);
    expect(host.settings.model).toBe('model-b');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(getDropdownConfig).toHaveBeenCalled();
    expect(ports).not.toHaveProperty('plugin');
    expect(ports).not.toHaveProperty('workspace');
    expect(ports).not.toHaveProperty('getPiWorkspace');
  });

  it('projects settings persistence and environment actions', async () => {
    const applyEnvironmentVariables = jest.fn(async () => {});
    const getPiWorkspace = jest.fn(() => {
      throw new Error('Settings ports must use the injected workspace.');
    });
    const host = {
      settings: {} as PiviSettings,
      saveSettings: async () => {},
      getUiFacades: () => createUiFacades(),
      getPiWorkspace,
      getActiveEnvironmentVariables: () => 'ACTIVE=1',
      getEnvironmentVariablesForScope: () => 'SCOPE=1',
      applyEnvironmentVariables,
      applyEnvironmentVariablesBatch: async () => {},
    } as unknown as PiviSettingsHost;
    const loadMcp = jest.fn(async () => []);
    const refreshCommands = jest.fn(async () => undefined);
    const readProviderCredential = jest.fn(() => ({ type: 'api_key', key: 'secret' }));
    const readWebCredential = jest.fn(() => ({ type: 'api_key', key: 'secret' }));
    const workspace = {
      credentialStore: { readSync: readProviderCredential },
      webSearchCredentialStore: { readSync: readWebCredential },
      mcpStorage: { load: loadMcp },
      slashCommandCatalog: { refresh: refreshCommands },
    };

    const ports = createSettingsUiPorts(host, workspace as never);

    expect(ports.environment.getActiveEnvironmentVariables()).toBe('ACTIVE=1');
    expect(ports.environment.getEnvironmentVariables('agent')).toBe('SCOPE=1');
    await ports.environment.applyEnvironmentVariables('agent', 'NEXT=1');
    expect(applyEnvironmentVariables).toHaveBeenCalledWith('agent', 'NEXT=1');
    expect(ports.complex.models.getCredentialKind('provider')).toBe('api_key');
    await expect(ports.complex.mcp.load()).resolves.toEqual([]);
    await ports.complex.commands.refresh();
    expect(ports.complex.webSearch.hasCredential('brave')).toBe(true);
    expect(readProviderCredential).toHaveBeenCalledWith('provider');
    expect(loadMcp).toHaveBeenCalledTimes(1);
    expect(refreshCommands).toHaveBeenCalledTimes(1);
    expect(readWebCredential).toHaveBeenCalledWith('brave');
    expect(getPiWorkspace).not.toHaveBeenCalled();
    expect(ports).not.toHaveProperty('plugin');
    expect(ports).not.toHaveProperty('storage');
  });

  it('fails explicitly when settings workspace is unavailable', () => {
    const getPiWorkspace = jest.fn();
    const host = {
      settings: {} as PiviSettings,
      getPiWorkspace,
      getUiFacades: () => createUiFacades(),
    } as unknown as PiviSettingsHost;

    expect(() => createSettingsUiPorts(host, null)).toThrow(
      'Pivi workspace services are not initialized.',
    );
    expect(getPiWorkspace).not.toHaveBeenCalled();
  });
});
