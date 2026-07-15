import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import * as defaultSkillsRemote from '@pivi/pivi-agent-core/skills/vault/fetchDefaultVaultSkillsRemoteSha';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const tempDirs: string[] = [];
  const createTempVault = () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-ui-ports-'));
    tempDirs.push(vaultPath);
    return vaultPath;
  };
  afterEach(() => {
    jest.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
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
      mcpToolProvider: { listTools, dispose: jest.fn() },
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
    const openRecentSessionMessages = jest.fn(async () => ({
      messages: [],
      hasOlder: true,
      totalMessageCount: 150,
      olderMessageCount: 50,
      olderUserMessageCount: 25,
    }));
    const readOlderSessionMessages = jest.fn(async () => ({
      messages: [],
      hasOlder: false,
      totalMessageCount: 150,
      olderMessageCount: 0,
      olderUserMessageCount: 0,
    }));
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
      openRecentSessionMessages,
      readOlderSessionMessages,
      createOpenSession: async () => ({ id: 'open-session' }),
      openSessionByFile: async () => ({ id: 'open-session' }),
      deleteSession: async () => {},
      renameSession: async () => {},
      updateSession: async () => {},
      forkSessionAt: async () => null,
    } as unknown as ChatUiCompositionHost;

    const ports = createChatUiPorts(host, workspace as never);

    expect(ports.runtime.createChatService()).toBe(chatService);
    await expect(ports.sessions.openRecent('open-session', 100)).resolves.toMatchObject({
      hasOlder: true,
      totalMessageCount: 150,
    });
    await expect(ports.sessions.readOlder('open-session', 'message-50', 100)).resolves.toMatchObject({
      hasOlder: false,
      totalMessageCount: 150,
    });
    expect(openRecentSessionMessages).toHaveBeenCalledWith('open-session', 100);
    expect(readOlderSessionMessages).toHaveBeenCalledWith('open-session', 'message-50', 100);
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
      notify: jest.fn(),
      getUiFacades: () => createUiFacades(),
      getPiWorkspace,
      getActiveEnvironmentVariables: () => 'ACTIVE=1',
      getEnvironmentVariablesForScope: () => 'SCOPE=1',
      applyEnvironmentVariables,
      applyEnvironmentVariablesBatch: async () => {},
    } as unknown as PiviSettingsHost;
    const loadMcp = jest.fn(async () => []);
    const getCachedMcpTools = jest.fn(() => [{ name: 'search' }]);
    const refreshCommands = jest.fn(async () => undefined);
    const readProviderCredential = jest.fn(() => ({ type: 'api_key', key: 'secret' }));
    const readWebCredential = jest.fn(() => ({ type: 'api_key', key: 'secret' }));
    const workspace = {
      credentialStore: { readSync: readProviderCredential },
      webSearchCredentialStore: { readSync: readWebCredential },
      mcpStorage: { load: loadMcp },
      mcpToolProvider: { getCachedTools: getCachedMcpTools },
      slashCommandCatalog: { refresh: refreshCommands },
    };

    const ports = createSettingsUiPorts(host, workspace as never);

    ports.feedback.notify('Settings saved.');
    expect(host.notify).toHaveBeenCalledWith('Settings saved.');
    expect(ports.environment.getActiveEnvironmentVariables()).toBe('ACTIVE=1');
    expect(ports.environment.getEnvironmentVariables('agent')).toBe('SCOPE=1');
    await ports.environment.applyEnvironmentVariables('agent', 'NEXT=1');
    expect(applyEnvironmentVariables).toHaveBeenCalledWith('agent', 'NEXT=1');
    expect(ports.complex.models.getCredentialKind('provider')).toBe('api_key');
    await expect(ports.complex.mcp.load()).resolves.toEqual([]);
    await expect(ports.complex.mcp.listTools('remote')).resolves.toEqual([{ name: 'search' }]);
    await ports.complex.commands.refresh();
    expect(ports.complex.webSearch.listProviders().find(provider => provider.id === 'brave')).toMatchObject({
      storedCredential: true,
      credentialConfigured: true,
    });
    expect(readProviderCredential).toHaveBeenCalledWith('provider');
    expect(loadMcp).toHaveBeenCalledTimes(1);
    expect(getCachedMcpTools).toHaveBeenCalledWith('remote');
    expect(refreshCommands).toHaveBeenCalledTimes(1);
    expect(readWebCredential).toHaveBeenCalledWith('brave');
    expect(getPiWorkspace).not.toHaveBeenCalled();
    expect(ports).not.toHaveProperty('plugin');
    expect(ports).not.toHaveProperty('storage');
  });

  it('persists subagent limits and refreshes the prompt in every open tab', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const refreshFirst = jest.fn(async () => undefined);
    const refreshSecond = jest.fn(async () => undefined);
    const host = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        agentSettings: {
          ...DEFAULT_PIVI_SETTINGS.agentSettings,
          subagents: { allowBackground: true, enabled: true, maxConcurrentSubagents: 3 },
        },
      } as PiviSettings,
      saveSettings,
      getAllViews: () => [
        { getChatHandle: () => ({ maintenance: { refreshRuntimePrompt: refreshFirst } }) },
        { getChatHandle: () => ({ maintenance: { refreshRuntimePrompt: refreshSecond } }) },
      ],
      getUiFacades: () => createUiFacades(),
    } as unknown as PiviSettingsHost;
    const workspace = {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    };
    const ports = createSettingsUiPorts(host, workspace as never);

    await ports.actions.saveSubagents({ maxConcurrentSubagents: 8 });

    expect(host.settings.agentSettings.subagents?.maxConcurrentSubagents).toBe(8);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshFirst).toHaveBeenCalledTimes(1);
    expect(refreshSecond).toHaveBeenCalledTimes(1);
  });

  it('applies tab bar position changes to every mounted view', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const refreshFirst = jest.fn();
    const refreshSecond = jest.fn();
    const host = {
      settings: { ...DEFAULT_PIVI_SETTINGS, tabBarPosition: 'input' } as PiviSettings,
      saveSettings,
      getAllViews: () => [
        { getChatHandle: () => ({ maintenance: { refreshTabBarPosition: refreshFirst } }) },
        { getChatHandle: () => ({ maintenance: { refreshTabBarPosition: refreshSecond } }) },
      ],
      getUiFacades: () => createUiFacades(),
    } as unknown as PiviSettingsHost;
    const workspace = {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    };
    const ports = createSettingsUiPorts(host, workspace as never);

    await ports.actions.saveGeneral({ tabBarPosition: 'header' });

    expect(host.settings.tabBarPosition).toBe('header');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshFirst).toHaveBeenCalledTimes(1);
    expect(refreshSecond).toHaveBeenCalledTimes(1);
  });

  it('invalidates slash catalogs when tool enablement changes', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const invalidateSlashCatalog = jest.fn();
    const refreshRuntimePrompt = jest.fn(async () => undefined);
    const host = {
      settings: { ...DEFAULT_PIVI_SETTINGS } as PiviSettings,
      saveSettings,
      getAllViews: () => [{
        getChatHandle: () => ({
          maintenance: { invalidateSlashCatalog, refreshRuntimePrompt },
        }),
      }],
      getUiFacades: () => createUiFacades(),
    } as unknown as PiviSettingsHost;
    const workspace = {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    };
    const ports = createSettingsUiPorts(host, workspace as never);

    await ports.complex.tools.setToolEnabled('obsidian_generate_image', false);

    expect(host.settings.agentSettings.obsidianTools?.disabledTools).toContain(
      'obsidian_generate_image',
    );
    expect(invalidateSlashCatalog).toHaveBeenCalledTimes(1);
    expect(refreshRuntimePrompt).toHaveBeenCalledTimes(1);
  });

  it('installs official skills and records successful bundle metadata', async () => {
    jest.spyOn(VaultSkillsService.prototype, 'installFromSource').mockResolvedValue(['obsidian-cli']);
    jest.spyOn(defaultSkillsRemote, 'fetchDefaultVaultSkillsRemoteSha').mockResolvedValue('remote-sha');
    const saveSettings = jest.fn(async () => undefined);
    const refreshVaultSkills = jest.fn(async () => undefined);
    const vaultPath = createTempVault();
    const host = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        defaultVaultSkillsPromptDismissed: true,
        defaultVaultSkillsRemovedFolders: ['obsidian-cli'],
      } as PiviSettings,
      saveSettings,
      refreshVaultSkills,
      getVaultPath: () => vaultPath,
      getUiFacades: () => createUiFacades(),
      httpClient: {},
      processRunner: {},
    } as unknown as PiviSettingsHost;
    const ports = createSettingsUiPorts(host, {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    } as never);

    await ports.complex.skills.featuredBundle.install();

    expect(host.settings.defaultVaultSkillsSeeded).toBe(true);
    expect(host.settings.defaultVaultSkillsCommitSha).toBe('remote-sha');
    expect(host.settings.defaultVaultSkillsPromptDismissed).toBeUndefined();
    expect(host.settings.defaultVaultSkillsRemovedFolders).toBeUndefined();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshVaultSkills).toHaveBeenCalledTimes(1);
  });

  it('does not change official skills metadata when installation fails', async () => {
    jest.spyOn(VaultSkillsService.prototype, 'installFromSource').mockRejectedValue(new Error('install failed'));
    jest.spyOn(defaultSkillsRemote, 'fetchDefaultVaultSkillsRemoteSha').mockResolvedValue('remote-sha');
    const saveSettings = jest.fn(async () => undefined);
    const vaultPath = createTempVault();
    const host = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        defaultVaultSkillsPromptDismissed: true,
        defaultVaultSkillsRemovedFolders: ['obsidian-cli'],
      } as PiviSettings,
      saveSettings,
      refreshVaultSkills: jest.fn(async () => undefined),
      getVaultPath: () => vaultPath,
      getUiFacades: () => createUiFacades(),
      httpClient: {},
      processRunner: {},
    } as unknown as PiviSettingsHost;
    const ports = createSettingsUiPorts(host, {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    } as never);

    await expect(ports.complex.skills.featuredBundle.install()).rejects.toThrow('install failed');

    expect(host.settings.defaultVaultSkillsSeeded).toBeFalsy();
    expect(host.settings.defaultVaultSkillsPromptDismissed).toBe(true);
    expect(host.settings.defaultVaultSkillsRemovedFolders).toEqual(['obsidian-cli']);
    expect(host.settings.defaultVaultSkillsCommitSha).toBeUndefined();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('updates official skills without restoring intentionally removed folders', async () => {
    const upgrade = jest.spyOn(VaultSkillsService.prototype, 'upgradeDefaultBundle').mockResolvedValue(['obsidian-cli']);
    jest.spyOn(defaultSkillsRemote, 'fetchDefaultVaultSkillsRemoteSha').mockResolvedValue('next-sha');
    const saveSettings = jest.fn(async () => undefined);
    const refreshVaultSkills = jest.fn(async () => undefined);
    const vaultPath = createTempVault();
    const host = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        defaultVaultSkillsRemovedFolders: ['defuddle'],
      } as PiviSettings,
      saveSettings,
      refreshVaultSkills,
      getVaultPath: () => vaultPath,
      getUiFacades: () => createUiFacades(),
      httpClient: {},
      processRunner: {},
    } as unknown as PiviSettingsHost;
    const ports = createSettingsUiPorts(host, {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    } as never);

    await ports.complex.skills.featuredBundle.update();

    expect(upgrade).toHaveBeenCalledWith(new Set(['defuddle']));
    expect(host.settings.defaultVaultSkillsRemovedFolders).toEqual(['defuddle']);
    expect(host.settings.defaultVaultSkillsCommitSha).toBe('next-sha');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshVaultSkills).toHaveBeenCalledTimes(1);
  });

  it('records only removed official skill folders', async () => {
    jest.spyOn(VaultSkillsService.prototype, 'remove').mockImplementation(() => undefined);
    const saveSettings = jest.fn(async () => undefined);
    const vaultPath = createTempVault();
    const host = {
      settings: { ...DEFAULT_PIVI_SETTINGS } as PiviSettings,
      saveSettings,
      refreshVaultSkills: async () => undefined,
      getVaultPath: () => vaultPath,
      getUiFacades: () => createUiFacades(),
      httpClient: {},
      processRunner: {},
    } as unknown as PiviSettingsHost;
    const ports = createSettingsUiPorts(host, {
      credentialStore: null,
      webSearchCredentialStore: null,
      mcpStorage: {},
      mcpToolProvider: {},
      slashCommandCatalog: {},
    } as never);

    await ports.complex.skills.remove('obsidian-cli');
    await ports.complex.skills.remove('custom-skill');

    expect(host.settings.defaultVaultSkillsRemovedFolders).toEqual(['obsidian-cli']);
    expect(saveSettings).toHaveBeenCalledTimes(1);
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
