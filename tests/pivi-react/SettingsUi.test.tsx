import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot, SettingsUiStore } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: {
    locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true,
    deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true,
    autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [],
    requireCommandOrControlEnterToSend: false,
    keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
  },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createModelsPort() {
  return {
    codexProviderId: 'openai-codex',
    bootstrap: () => ({ minimumHostVersion: '1.11.4', secureStorageAvailable: true }),
    getSettings: () => ({ addedProviders: ['openai'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
    saveSettings: async () => undefined,
    getProviderDisplayName: (id: string) => id,
    getProviderLogoSlug: () => null,
    getReadiness: () => 'ready' as const,
    getCredentialKind: () => null,
    getProviderEnvInfo: () => ({ apiKeyVar: 'OPENAI_API_KEY' }),
    getSecretId: (id: string) => `pivi-${id}-credential`,
    setApiKey: async () => undefined,
    setOauthToken: async () => undefined,
    clearCredential: async () => undefined,
    hasCodexAuth: () => false,
    loginCodex: async () => undefined,
    logoutCodex: () => undefined,
    listAddableBuiltinProviders: () => [{ id: 'anthropic', name: 'anthropic', logoSlug: null }],
    listAddableLocalKinds: () => [],
    listCustomKinds: () => [],
    addBuiltinProvider: async () => undefined,
    addCustomKind: async () => 'custom-openai-compatible',
    removeProvider: async () => undefined,
    testProvider: async () => ({ ok: true, detail: 'ok' }),
    patchCustomProvider: async () => undefined,
    fetchCustomProviderModels: async () => ({ count: 0 }),
    notify: () => undefined,
  };
}

function createPorts(overrides: Partial<SettingsPorts['actions']> = {}): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    actions: {
      saveGeneral: async () => undefined,
      saveSubagents: async () => undefined,
      purgeDeletedSessionFiles: async () => 0,
      ...overrides,
    },
    complex: {
      models: createModelsPort(),
      skills: {
        featuredBundle: {
          getDescriptor: () => ({
            name: 'Featured skills',
            description: 'Featured skills for this host.',
            source: 'example/skills',
            sourceUrl: 'https://example.com/skills',
          }),
          isInstalled: () => false,
          install: async () => undefined,
        },
        list: () => [{ name: 'Example', description: 'Example skill', folderName: 'example', disabled: false }],
        listRemote: async () => [{ name: 'Remote', description: 'Remote skill' }],
        install: async () => undefined,
        setDisabled: async () => undefined,
        remove: async () => undefined,
        updateAll: async () => undefined,
        update: async () => undefined,
      },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: {
      getActiveEnvironmentVariables: () => '',
      getEnvironmentVariables: () => '',
      applyEnvironmentVariables: async () => undefined,
      applyEnvironmentVariablesBatch: async () => undefined,
      getReviewKeys: () => [],
    },
    hotkeys: {
      listHotkeys: () => [
        { commandId: 'pivi:open-view', labelKey: 'settings.openChatHotkey.name', hotkey: 'Mod+P' },
      ],
      openHotkeySettings: () => undefined,
    },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: async () => [], runAction: async () => ({}) },
  };
}

describe('React settings foundation', () => {
  it('switches tabs and persists a changed setting', async () => {
    const saveGeneral = jest.fn(async () => undefined);
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));
    expect(screen.getByText('Language')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Subagents' }));
    expect(screen.getByText('Enable spawn_agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    const autoScroll = screen.getByRole('checkbox', { name: 'Auto-scroll during streaming' });
    fireEvent.click(autoScroll!);
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenCalledWith({ enableAutoScroll: false });
  });

  it('debounces the latest keyboard navigation text', async () => {
    jest.useFakeTimers();
    try {
      const saveGeneral = jest.fn(async () => undefined);
      const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));
      const textarea = Array.from(container.querySelectorAll('textarea')).find((element) => (
        element.value.includes('scrollUp')
      ));
      expect(textarea).toBeDefined();
      if (!textarea) throw new Error('Expected keyboard navigation mappings textarea.');

      fireEvent.change(textarea, {
        target: { value: 'map k scrollUp\nmap j scrollDown\nmap f focusInput' },
      });
      await act(async () => { jest.advanceTimersByTime(500); });

      expect(saveGeneral).toHaveBeenCalledWith({
        keyboardNavigation: {
          scrollUpKey: 'k',
          scrollDownKey: 'j',
          focusInputKey: 'f',
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders and runs host-provided integration sections', async () => {
    const runAction = jest.fn(async () => ({ message: 'Host integration complete.' }));
    const ports = createPorts();
    ports.hostIntegrations = {
      listSections: async () => [{
        id: 'host:section',
        heading: 'Host extension',
        description: 'Connect Pivi to the note host.',
        actions: [{ id: 'host:connect', label: 'Connect' }, { id: 'host:configure', label: 'Configure' }],
      }],
      runAction,
    };
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="integrations" /></I18nProvider>));
    await screen.findByText('Host extension');
    const integrationSetting = container.querySelector<HTMLElement>('.pivi-integration-setting.pivi-setting-stack');
    expect(integrationSetting).not.toBeNull();
    expect(within(integrationSetting!).getByText('Host extension')).toHaveClass('pivi-setting-row__name');
    expect(within(integrationSetting!).getByText('Connect Pivi to the note host.')).toBeInTheDocument();
    expect(within(integrationSetting!).getAllByRole('button')).toHaveLength(2);
    expect(integrationSetting!.querySelector('.pivi-setting-row--heading')).toBeNull();
    expect(integrationSetting!.querySelector('.pivi-setting-row__name:empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => undefined);
    expect(runAction).toHaveBeenCalledWith('host:connect');
    expect(screen.getByText('Host integration complete.')).toBeInTheDocument();
  });

  it('renders unavailable host integration actions as disabled with their reason', async () => {
    const ports = createPorts();
    ports.hostIntegrations = {
      listSections: async () => [{
        id: 'host:section',
        heading: 'Host extension',
        description: 'Connect Pivi to the note host.',
        actions: [{ id: 'host:connect', label: 'Connect', disabled: true, disabledReason: 'Install the host extension first.' }],
      }],
      runAction: async () => ({}),
    };
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="integrations" /></I18nProvider>));

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByText('Install the host extension first.')).toBeInTheDocument();
  });

  it('keeps snapshots immutable and stops notifying after dispose', () => {
    const store = new SettingsUiStore(snapshot);
    const listener = jest.fn();
    store.subscribe(listener);
    const first = store.getSnapshot();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.general)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    store.dispose();
    store.updateGeneral({ userName: 'ignored' });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(first);
  });

  it('lists remote skills and installs selected skills', async () => {
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} /></I18nProvider>));
    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));
    const remoteSetting = container.querySelector<HTMLElement>('.pivi-skills-remote-setting');
    const installedHeader = screen.getByText('Installed skills').closest('.pivi-settings-list-header');
    expect(remoteSetting).not.toBeNull();
    expect(installedHeader).not.toBeNull();
    expect(installedHeader).toHaveClass('pivi-settings-list-header');
    expect(remoteSetting!.querySelector('.pivi-setting-row')).toBeInTheDocument();
    expect(within(remoteSetting!).getByText('Install from remote')).toBeInTheDocument();
    expect(within(remoteSetting!).getByRole('textbox')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'owner/repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'List skills' }));
    await act(async () => undefined);
    expect(screen.getByLabelText(/Remote/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Remote/));
    fireEvent.click(screen.getByRole('button', { name: 'Install selected skills' }));
    await act(async () => undefined);
  });
  it('expands a provider card and persists visible model selection', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.catalog, { listModelsForProvider: () => [{ value: 'openai/gpt', label: 'GPT' }] });
    Object.assign(ports.complex.models, { saveSettings });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>));
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(screen.getByText('openai')).toBeInTheDocument();
    fireEvent.click(screen.getByText('openai'));
    expect(screen.getByText('Candidate models pool')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('GPT'));
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenCalledWith({ visibleModels: ['openai/gpt'] });
  });
  it('reorders model providers with the keyboard while retaining provider icons', async () => {
    const modelSettings = {
      addedProviders: ['openai', 'anthropic'],
      disabledProviders: [],
      customProviders: [],
      visibleModels: [],
      availableModes: [],
      discoveredModels: [],
      environmentVariables: '',
      selectedMode: '',
    };
    const saveSettings = jest.fn(async (patch: Partial<typeof modelSettings>) => {
      Object.assign(modelSettings, patch);
    });
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      getSettings: () => ({ ...modelSettings, addedProviders: [...modelSettings.addedProviders] }),
      getProviderLogoSlug: (id: string) => id,
      saveSettings,
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    const handle = screen.getByRole('button', { name: /Reorder openai/ });

    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledWith({ addedProviders: ['anthropic', 'openai'] });
    expect(container.querySelectorAll('.pivi-model-provider-card .pivi-provider-logo-mask')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Reorder openai, currently position 2/ })).toBeInTheDocument();
  });
  it('rolls model provider order back when persistence fails', async () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      getSettings: () => ({ addedProviders: ['openai', 'anthropic'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
      saveSettings: async () => { throw new Error('Unable to save provider order'); },
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    const handle = screen.getByRole('button', { name: /Reorder openai/ });

    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(screen.getByRole('button', { name: /Reorder openai, currently position 1/ })).toBeInTheDocument();
    expect(screen.getByText('Unable to save provider order')).toBeInTheDocument();
  });
  it('renders credential guidance with injected host terminology', () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      bootstrap: () => ({ minimumHostVersion: '2.0.0', secureStorageAvailable: false }),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    expect(screen.getByText(/Test host 2\.0\.0 or newer with secure storage/)).toBeInTheDocument();
    expect(screen.getByText(/stored in secure storage/)).toBeInTheDocument();
  });
  it('calls provider credential and Codex OAuth ports from an expanded card', async () => {
    const setApiKey = jest.fn(async () => undefined);
    const clearCredential = jest.fn(async () => undefined);
    const loginCodex = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      setApiKey,
      clearCredential,
      loginCodex,
      getSettings: () => ({ addedProviders: ['openai', 'openai-codex'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
      getCredentialKind: (id: string) => (id === 'openai' ? 'api_key' : null),
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>));
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    const credentialSetting = container.querySelector<HTMLElement>('.pivi-cred-row');
    expect(credentialSetting).not.toBeNull();
    expect(within(credentialSetting!).getByText('API key')).toBeInTheDocument();
    expect(within(credentialSetting!).getByRole('textbox')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => undefined);
    expect(setApiKey).toHaveBeenCalledWith('openai', 'secret');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clearCredential).toHaveBeenCalledWith('openai');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => undefined);
    expect(loginCodex).toHaveBeenCalled();
  });
  it('keeps Codex actions below the sign-in guidance', () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      hasCodexAuth: () => true,
      getSettings: () => ({ addedProviders: ['openai-codex'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    const codexSetting = container.querySelector<HTMLElement>('.pivi-codex-setting');
    expect(codexSetting).not.toBeNull();
    expect(within(codexSetting!).getByText('Sign in with your ChatGPT/Codex subscription. Credentials are stored in secure storage.')).toBeInTheDocument();
    expect(within(codexSetting!).queryByText(/auth\.json/)).toBeNull();
    expect(within(codexSetting!).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });
  it('fetches custom provider models and saves checklist changes', async () => {
    const fetchCustomProviderModels = jest.fn(async () => ({ count: 1 }));
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.catalog, { listModelsForProvider: () => [{ value: 'openai/gpt', label: 'GPT' }] });
    Object.assign(ports.complex.models, {
      getSettings: () => ({ addedProviders: ['openai'], disabledProviders: [], customProviders: [{ id: 'openai', kind: 'openai-compatible', name: 'OpenAI', baseUrl: 'https://example.test', api: 'openai-completions', models: [] }], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
      fetchCustomProviderModels,
      saveSettings,
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>));
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    fireEvent.click(screen.getByText('OpenAI'));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    await act(async () => undefined);
    expect(fetchCustomProviderModels).toHaveBeenCalledWith('openai');
    fireEvent.click(screen.getByLabelText('GPT'));
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenCalled();
  });
  it('confirms provider removal and keeps credentials by default', async () => {
    const removeProvider = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, { removeProvider });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove openai provider?' });
    const deleteCredential = within(dialog).getByRole('checkbox', {
      name: "Also delete this provider's credential from secure storage",
    });
    expect(deleteCredential).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await act(async () => undefined);

    expect(removeProvider).toHaveBeenCalledWith('openai', false);
  });
  it('deletes only the selected provider credential when explicitly requested', async () => {
    const removeProvider = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, { removeProvider });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove openai provider?' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await act(async () => undefined);

    expect(removeProvider).toHaveBeenCalledWith('openai', true);
  });
  it('disables the cleanup action while its async port action is pending', async () => {
    let resolve!: (count: number) => void;
    const purgeDeletedSessionFiles = jest.fn(() => new Promise<number>((resolvePromise) => { resolve = resolvePromise; }));
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ purgeDeletedSessionFiles })} /></I18nProvider>));
    const button = screen.getByRole('button', { name: 'Delete removed files' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await act(async () => resolve(3));
    expect(screen.getByText('Deleted 3 removed session file(s).')).toBeInTheDocument();
  });
});
