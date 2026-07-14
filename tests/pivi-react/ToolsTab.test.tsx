import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
      webSearch: {
        getSettings: () => ({ providerOrder: ['brave', 'tavily', 'exa', 'anysearch'], disabledProviders: [] }),
        listProviders: () => [
          { id: 'brave', search: true, fetch: false, apiKeyRequired: true, credentialConfigured: false, environmentCredential: false, storedCredential: false },
          { id: 'tavily', search: true, fetch: true, apiKeyRequired: true, credentialConfigured: false, environmentCredential: false, storedCredential: false },
          { id: 'exa', search: true, fetch: true, apiKeyRequired: true, credentialConfigured: false, environmentCredential: false, storedCredential: false },
          { id: 'anysearch', search: true, fetch: true, apiKeyRequired: false, credentialConfigured: false, environmentCredential: false, storedCredential: false },
        ],
        saveSettings: async () => undefined,
        writeCredential: () => undefined,
        clearCredential: () => undefined,
      },
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
  return render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="tools" /></I18nProvider>));
}

describe('React tools settings', () => {
  it('stacks external directory controls below their description', () => {
    const { container } = renderTools(createPorts());
    const setting = container.querySelector<HTMLElement>('.pivi-external-directories-setting.pivi-setting-stack');
    expect(setting).not.toBeNull();
    expect(within(setting!).getByText('Allowed external directories')).toBeInTheDocument();
    expect(within(setting!).getByRole('textbox')).toBeInTheDocument();
    expect(within(setting!).getByRole('button', { name: 'Browse' })).toBeInTheDocument();
  });

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

  it('reorders web providers with the keyboard and saves once on drop', async () => {
    const ports = createPorts();
    const saveSettings = jest.fn(async () => undefined);
    ports.complex.webSearch.saveSettings = saveSettings;
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>));
    const handle = screen.getByRole('button', { name: /Reorder Brave Search/ });

    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(saveSettings).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledWith({
      providerOrder: ['tavily', 'brave', 'exa', 'anysearch'],
      disabledProviders: [],
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('tracks a pointer drag and persists the previewed provider order on release', async () => {
    const ports = createPorts();
    const saveSettings = jest.fn(async () => undefined);
    ports.complex.webSearch.saveSettings = saveSettings;
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>));
    const handle = screen.getByRole('button', { name: /Reorder Brave Search/ }) as HTMLButtonElement;
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-provider-sort-id]'));
    for (const card of cards) {
      card.getBoundingClientRect = jest.fn(() => {
        const index = Array.from(card.parentElement?.children ?? []).indexOf(card);
        const dragOffset = Number.parseFloat(card.style.getPropertyValue('--pivi-provider-drag-y')) || 0;
        const top = index * 100 + dragOffset;
        return { top, bottom: top + 80, height: 80, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) };
      });
    }
    handle.setPointerCapture = jest.fn();
    handle.releasePointerCapture = jest.fn();
    handle.hasPointerCapture = jest.fn(() => true);
    const pointerEvent = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        pointerId: { value: 1 },
        clientY: { value: clientY },
      });
      return event;
    };

    fireEvent(handle, pointerEvent('pointerdown', 10));
    for (const clientY of [20, 60, 100, 150, 190, 250, 350]) {
      fireEvent(handle, pointerEvent('pointermove', clientY));
    }
    fireEvent(handle, pointerEvent('pointerup', 250));
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledWith({
      providerOrder: ['tavily', 'exa', 'anysearch', 'brave'],
      disabledProviders: [],
    });
  });

  it('keeps the original keyboard rollback when another handle is pressed', () => {
    const ports = createPorts();
    const saveSettings = jest.fn(async () => undefined);
    ports.complex.webSearch.saveSettings = saveSettings;
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>));
    const braveHandle = screen.getByRole('button', { name: /Reorder Brave Search/ });

    fireEvent.keyDown(braveHandle, { key: ' ' });
    fireEvent.keyDown(braveHandle, { key: 'ArrowDown' });
    const tavilyHandle = screen.getByRole('button', { name: /Reorder Tavily/ });
    fireEvent.keyDown(tavilyHandle, { key: ' ' });
    fireEvent.keyDown(braveHandle, { key: 'Escape' });

    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Reorder Brave Search, currently position 1/ })).toBeInTheDocument();
  });

  it('keeps a persisted provider order when runtime refresh fails', async () => {
    const ports = createPorts();
    const saveSettings = jest.fn(async () => undefined);
    ports.complex.webSearch.saveSettings = saveSettings;
    ports.complex.runtime.refreshPrompt = async () => { throw new Error('refresh failed'); };
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="webSearch" /></I18nProvider>));
    const handle = screen.getByRole('button', { name: /Reorder Brave Search/ });

    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Reorder Brave Search, currently position 2/ })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Error');
  });

  it('renders provider brand icons and keeps reorder announcements out of visual layout', () => {
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} initialTab="webSearch" /></I18nProvider>));

    expect(container.querySelectorAll('.pivi-web-provider-card .pivi-provider-logo-mask')).toHaveLength(4);
    expect(container.querySelector('[aria-live="polite"]')).toHaveClass('pivi-visually-hidden');
  });
});
