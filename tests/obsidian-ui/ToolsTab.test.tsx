import { act, fireEvent, render, screen } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/obsidian-ui';
import type { SettingsPorts } from '@pivi/obsidian-ui/ports';
import type { SettingsUiSnapshotData } from '@pivi/obsidian-ui/settings';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true, autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createPorts(overrides: Partial<SettingsPorts['complex']['tools']> = {}): SettingsPorts {
  const settings = { allowBash: false, bashAllowlist: [] as readonly string[], allowExternalRead: false, externalReadDirectories: [] as readonly string[], disabledTools: [] as readonly string[], officialCliEnabled: false };
  return {
    snapshot: { getSnapshot: () => snapshot },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0, openStyleSettings: async () => true, setupNoteToolbarIntegration: async () => ({ status: 'installed' }) },
    complex: {
      tools: { getSettings: () => settings, chooseExternalDirectory: async () => null, validateExternalDirectory: async () => ({ valid: true }), saveSettings: async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]) => { Object.assign(settings, patch); }, ...overrides },
      webSearch: { getSettings: () => ({ searchProvider: 'auto', fetchProvider: 'auto' }), saveSettings: async () => undefined, hasCredential: () => false, writeCredential: () => undefined, clearCredential: () => undefined },
      models: { hasCodexAuth: () => false },
      runtime: { refreshPrompt: async () => undefined, refreshModelSelectors: () => undefined },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
  };
}

function renderTools(ports: SettingsPorts) {
  render(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="tools" /></I18nProvider>);
}

describe('React tools settings', () => {
  it('persists Bash availability through the tools port', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts({ saveSettings });
    renderTools(ports);
    const bashToggle = screen.getAllByRole('checkbox').at(-1)!;
    fireEvent.click(bashToggle);
    await act(async () => undefined);
    expect(bashToggle).toBeDefined();
    expect(saveSettings).toHaveBeenCalledWith({ allowBash: true });
    expect(saveSettings).toHaveBeenCalledTimes(1);
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
    renderTools(createPorts());
    expect(screen.getAllByRole('checkbox')[8]!).toBeDisabled();
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
    render(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>);
    const input = screen.getAllByPlaceholderText('Enter API key...')[0]!;
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.blur(input);
    await act(async () => undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent('Error');
    expect(input).not.toBeDisabled();
  });
});
