import { act, fireEvent, render, screen } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true, autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createPorts(overrides: Partial<SettingsPorts['complex']['tools']> = {}): SettingsPorts {
  const settings = { allowBash: false, bashAllowlist: [] as readonly string[], allowExternalRead: false, externalReadDirectories: [] as readonly string[] };
  return {
    snapshot: { getSnapshot: () => snapshot },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0 },
    complex: {
      tools: { getSettings: () => settings, listToolRows: () => [{ name: 'host_tool', label: 'Host tool', description: 'Host capability', enabled: false, available: true }], setToolEnabled: async () => undefined, chooseExternalDirectory: async () => null, validateExternalDirectory: async () => ({ valid: true }), saveSettings: async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]) => { Object.assign(settings, patch); }, ...overrides },
      webSearch: { getSettings: () => ({ searchProvider: 'auto', fetchProvider: 'auto' }), saveSettings: async () => undefined, hasCredential: () => false, writeCredential: () => undefined, clearCredential: () => undefined },
      models: { hasCodexAuth: () => false },
      runtime: { refreshPrompt: async () => undefined, refreshModelSelectors: () => undefined },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: () => [], runAction: async () => ({}) },
  };
}

function renderTools(ports: SettingsPorts) {
  render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="tools" /></I18nProvider>));
}

describe('React tools settings', () => {
  it('delegates host tool availability changes through the tools port', async () => {
    const setToolEnabled = jest.fn(async () => undefined);
    const ports = createPorts({ setToolEnabled });
    renderTools(ports);
    const hostToolToggle = screen.getAllByRole('checkbox').at(-1)!;
    expect(hostToolToggle.parentElement).toHaveClass('pivi-toggle');
    expect(hostToolToggle.parentElement).not.toHaveClass('checkbox-container', 'is-enabled', 'is-disabled');
    fireEvent.click(hostToolToggle);
    await act(async () => undefined);
    expect(setToolEnabled).toHaveBeenCalledWith('host_tool', true);
  });

  it('normalizes and saves the Bash allowlist on blur', async () => {
    const saveSettings = jest.fn(async () => undefined);
    renderTools(createPorts({ saveSettings }));
    const bashAllowlist = screen.getAllByRole('textbox').find((element) => element.tagName === 'TEXTAREA' && !element.classList.contains('pivi-settings-external-dirs-textarea'))!;
    fireEvent.change(bashAllowlist, { target: { value: 'git\nnpm run build\ngit\n' } });
    fireEvent.blur(bashAllowlist);
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenCalledWith({ bashAllowlist: ['git', 'npm run build'] });
  });

  it('keeps unavailable tools disabled and reports invalid external paths', async () => {
    renderTools(createPorts({ listToolRows: () => [{ name: 'unavailable', label: 'Unavailable host tool', description: 'Requires host support', enabled: false, available: false }] }));
    expect(screen.getAllByRole('checkbox').at(-1)!).toBeDisabled();
    const textarea = document.querySelector<HTMLTextAreaElement>('.pivi-settings-external-dirs-textarea')!;
    fireEvent.change(textarea, { target: { value: 'relative/path' } });
    fireEvent.blur(textarea);
    expect(await screen.findByRole('alert')).toHaveTextContent('External read directories not saved');
  });


  it('handles canceled and failed directory picker results without persisting', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts({ saveSettings });
    const chooseExternalDirectory = jest.fn(async () => null);
    ports.complex.tools.chooseExternalDirectory = chooseExternalDirectory;
    renderTools(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await act(async () => undefined);
    expect(chooseExternalDirectory).toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });


  it('validates and saves a selected directory', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts({ saveSettings });
    ports.complex.tools.chooseExternalDirectory = async () => '/Users/me/workspace';
    renderTools(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenCalledWith({ externalReadDirectories: ['/Users/me/workspace'] });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
  it('reports a directory picker failure and restores the button', async () => {
    const ports = createPorts();
    ports.complex.tools.chooseExternalDirectory = async () => { throw new Error('unavailable'); };
    renderTools(ports);
    const browse = screen.getByRole('button', { name: 'Browse' });
    fireEvent.click(browse);
    await act(async () => undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to open folder picker.');
    expect(browse).not.toBeDisabled();
  });
  it('clears busy state when saving a web credential fails', async () => {
    const ports = createPorts();
    ports.complex.webSearch.writeCredential = () => { throw new Error('keychain unavailable'); };
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>));
    const input = screen.getAllByPlaceholderText('Enter API key...')[0]!;
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.blur(input);
    await act(async () => undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent('Error');
    expect(input).not.toBeDisabled();
  });
});
