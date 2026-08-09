import type { ChatUIOption } from '@pivi/pivi-agent-core/foundation/chatUi';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';

import type { PiviPluginWorkspace, PiviSettingsHost, PiviUiFacades } from '@/app/hostContracts';
import { createSettingsModelsPort } from '@/app/ui/createSettingsModelsPort';

function createHarness() {
  const settings = {
    ...DEFAULT_PIVI_SETTINGS,
    model: 'anthropic/claude-test',
    titleGenerationModel: 'anthropic/claude-test',
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      addedProviders: ['anthropic', 'deepseek'],
      disabledProviders: ['anthropic'],
      visibleModels: ['anthropic/claude-test'],
      customProviders: [],
    },
  };
  const saveSettings = jest.fn(async () => undefined);
  const refreshModelPresentation = jest.fn();
  const deleteCredential = jest.fn(async () => undefined);
  const deepseekModel: ChatUIOption = {
    value: 'deepseek/deepseek-chat',
    label: 'DeepSeek Chat',
  };
  const host = {
    app: { secretStorage: undefined },
    settings,
    saveSettings,
    getAllViews: () => [{
      getChatHandle: () => ({ maintenance: { refreshModelPresentation } }),
    }],
  } as unknown as PiviSettingsHost;
  const uiFacades = {
    listModelsForProvider: (providerId: string) => providerId === 'deepseek' ? [deepseekModel] : [],
    syncCustomProviders: jest.fn(),
    getSettingsSnapshot: <T extends Record<string, unknown>>(value: T) => ({ ...value }),
    commitSettingsSnapshot: (target: Record<string, unknown>, snapshot: Record<string, unknown>) => {
      Object.assign(target, snapshot);
    },
  } as unknown as PiviUiFacades;
  const workspace = {
    credentialStore: {
      readSync: () => undefined,
      modify: async () => undefined,
      delete: deleteCredential,
    },
  } as unknown as PiviPluginWorkspace;

  return {
    deleteCredential,
    host,
    port: createSettingsModelsPort(host, uiFacades, workspace),
    refreshModelPresentation,
    saveSettings,
    settings,
    uiFacades,
  };
}

describe('createSettingsModelsPort provider removal', () => {
  it('writes a replacement credential before attempting any settings persistence', async () => {
    const harness = createHarness();
    const events: string[] = [];
    const modify = jest.fn(async () => {
      events.push('secret');
    });
    harness.saveSettings.mockImplementation(async () => {
      events.push('settings');
      throw new Error('save failed');
    });
    const port = createSettingsModelsPort(
      harness.host,
      harness.uiFacades,
      {
        credentialStore: {
          readSync: () => undefined,
          modify,
          delete: harness.deleteCredential,
        },
      } as unknown as PiviPluginWorkspace,
    );

    await expect(port.setApiKey('anthropic', 'replacement')).rejects.toThrow('save failed');

    expect(events).toEqual(['secret', 'settings']);
    expect(modify).toHaveBeenCalledWith('anthropic', expect.any(Function));
    expect(harness.deleteCredential).not.toHaveBeenCalled();
  });

  it('keeps in-memory provider order when synced save fails after local commit', async () => {
    const harness = createHarness();
    harness.saveSettings.mockRejectedValueOnce(new Error('save failed'));

    await expect(harness.port.saveSettings({
      addedProviders: ['deepseek', 'anthropic'],
    })).rejects.toThrow('save failed');

    expect(harness.settings.agentSettings.addedProviders).toEqual(['deepseek', 'anthropic']);
    expect(harness.refreshModelPresentation).not.toHaveBeenCalled();
  });

  it('cleans provider settings and reconciles active and title models', async () => {
    const harness = createHarness();

    await harness.port.removeProvider('anthropic', false);

    expect(harness.settings.agentSettings).toMatchObject({
      addedProviders: ['deepseek'],
      disabledProviders: [],
      visibleModels: ['deepseek/deepseek-chat'],
      customProviders: [],
    });
    expect(harness.settings.model).toBe('deepseek/deepseek-chat');
    expect(harness.settings.titleGenerationModel).toBe('');
    expect(harness.deleteCredential).not.toHaveBeenCalled();
    expect(harness.saveSettings).toHaveBeenCalledTimes(1);
    expect(harness.refreshModelPresentation).toHaveBeenCalledTimes(1);
  });

  it('deletes the provider credential only when explicitly requested', async () => {
    const harness = createHarness();

    await harness.port.removeProvider('anthropic', true);

    expect(harness.deleteCredential).toHaveBeenCalledWith('anthropic');
  });

  it('retains the credential when provider settings fail to persist', async () => {
    const harness = createHarness();
    harness.saveSettings.mockRejectedValueOnce(new Error('save failed'));

    await expect(harness.port.removeProvider('anthropic', true)).rejects.toThrow('save failed');

    expect(harness.deleteCredential).not.toHaveBeenCalled();
  });

  it('does not select a disabled provider as the active fallback', async () => {
    const harness = createHarness();
    harness.settings.agentSettings.disabledProviders = ['anthropic', 'deepseek'];

    await harness.port.removeProvider('anthropic', false);

    expect(harness.settings.agentSettings.disabledProviders).toEqual(['deepseek']);
    expect(harness.settings.model).toBe('');
    expect(harness.settings.titleGenerationModel).toBe('');
  });

  it('fails before removing settings when requested credential storage is unavailable', async () => {
    const harness = createHarness();
    const workspaceWithoutCredentials = {} as PiviPluginWorkspace;
    const port = createSettingsModelsPort(
      harness.host,
      harness.uiFacades,
      workspaceWithoutCredentials,
    );

    await expect(port.removeProvider('anthropic', true)).rejects.toThrow(
      'Provider credential storage is unavailable.',
    );
    expect(harness.settings.agentSettings.addedProviders).toContain('anthropic');
  });
});
