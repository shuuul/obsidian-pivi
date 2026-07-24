import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot, SettingsUiStore } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: {
    locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true,
    deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false,
    userName: '', excludedTags: [],
    requireCommandOrControlEnterToSend: false,
    keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
    editorSelectionToolbar: { enabled: true, shortcuts: [] },
  },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createModelsPort() {
  return {
    codexProviderId: 'openai-codex',
    interactiveOAuthProviderIds: ['openai-codex', 'grok-build', 'claude'],
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
    hasProviderOAuth: () => false,
    loginProviderOAuth: async () => undefined,
    cancelProviderOAuthLogin: () => undefined,
    logoutProviderOAuth: async () => undefined,
    listAddableBuiltinProviders: () => [{ id: 'anthropic', name: 'anthropic', logoSlug: null }],
    listAddableLocalKinds: () => [],
    listCustomKinds: () => [],
    addBuiltinProvider: async () => undefined,
    addCustomKind: async () => 'custom-openai-compatible',
    removeProvider: async () => undefined,
    ensureProviderCredentials: async () => undefined,
    testProvider: async () => ({ ok: true, detail: 'ok' }),
    patchCustomProvider: async () => undefined,
    fetchCustomProviderModels: async () => ({ count: 0 }),
  };
}

function createPorts(overrides: Partial<SettingsPorts['actions']> = {}): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    feedback: { notify: jest.fn() },
    actions: {
      saveGeneral: async () => undefined,
      saveSubagents: async () => undefined,
      saveEditorSelectionToolbar: async () => undefined,
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
          update: async () => undefined,
        },
        list: () => [{ name: 'Example', description: 'Example skill', folderName: 'example', disabled: false }],
        listRemote: async () => [{ name: 'Remote', description: 'Remote skill' }],
        install: async () => undefined,
        setDisabled: async () => undefined,
        remove: async () => undefined,
        updateAll: async () => undefined,
        update: async () => undefined,
      },
      commands: {
        refresh: async () => undefined,
        listIconNames: () => [],
        listWorkspaceEntries: async () => [],
        listDropdownEntries: async () => [],
        saveWorkspaceEntry: async (entry: never) => entry,
        deleteWorkspaceEntry: async () => undefined,
        saveWorkspaceOrder: async () => undefined,
      },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: {
      getActiveEnvironmentVariables: () => '',
      getEnvironmentVariables: () => '',
      applyEnvironmentVariables: async () => undefined,
      applyEnvironmentVariablesBatch: async () => undefined,
      importEnvironmentText: async () => undefined,
      listEntries: () => [],
      getReviewKeys: () => [],
    },
    hotkeys: {
      listHotkeys: () => [
        { commandId: 'pivi:open-view', labelKey: 'settings.openChatHotkey.name', hotkey: 'Mod+P' },
      ],
      openHotkeySettings: () => undefined,
    },
    editorToolbar: {
      listHostCommands: () => [],
      listPiviCommands: async () => [],
      listIconNames: () => [],
      isNoteToolbarTextToolbarActive: () => false,
    },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: () => [], runAction: async () => ({}) },
    mentionEditor: { mount: () => ({ getValue: () => '', setValue: () => undefined, focus: () => undefined, setDisabled: () => undefined, destroy: () => undefined }) },
  };
}

describe('React settings foundation', () => {
  it('renders seven accessible primary tabs with keyboard navigation and active-tab scrolling', () => {
    const scrollIntoView = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    try {
      render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} /></I18nProvider>));
      const tabs = screen.getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        'General', 'Models', 'Skills', 'Tools', 'Subagents', 'Commands', 'Toolbar',
      ]);
      expect(screen.queryByRole('tab', { name: 'Web' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'MCPs' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Integrations' })).not.toBeInTheDocument();
      expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);

      const panel = screen.getByRole('tabpanel');
      expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', tabs[0]?.id);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });

      fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
      expect(tabs[1]).toHaveFocus();
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(tabs[1]!, { key: 'End' });
      expect(tabs[6]).toHaveFocus();
      fireEvent.keyDown(tabs[6]!, { key: 'Home' });
      expect(tabs[0]).toHaveFocus();
      fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
      expect(tabs[6]).toHaveFocus();
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, -1, -1, -1, 0]);
      expect(panel).toHaveAttribute('aria-labelledby', tabs[6]?.id);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('switches tabs and persists a changed setting', async () => {
    const saveGeneral = jest.fn(async () => undefined);
    const saveSubagents = jest.fn(async () => undefined);
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ saveGeneral, saveSubagents })} /></I18nProvider>));
    expect(screen.getByText('Language')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Subagents' }));
    expect(screen.getByText('Enable spawn_agent')).toBeInTheDocument();
    expect(screen.queryByText('Show active work shelf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow background subagents' }));
    await act(async () => undefined);
    expect(saveSubagents).toHaveBeenCalledWith({ allowBackground: true });
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    const autoScroll = screen.getByRole('checkbox', { name: 'Auto-scroll during streaming' });
    fireEvent.click(autoScroll!);
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenCalledWith({ enableAutoScroll: false });
  });

  it('does not expose internal compaction policy as a setting', () => {
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} /></I18nProvider>));
    expect(screen.queryByText('Compaction')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Compact threshold' })).not.toBeInTheDocument();
  });

  it('applies a language change immediately and renders tabs without duplicate page headings', async () => {
    const saveGeneral = jest.fn(async () => undefined);
    const i18n = createI18n();
    render(withTestPresentationPlatform(<I18nProvider i18n={i18n}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'zh-CN' } });

    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '语言' })).toHaveClass('pivi-select');
    expect(saveGeneral).toHaveBeenCalledWith({ locale: 'zh-CN' });
    fireEvent.click(screen.getByRole('tab', { name: '子代理' }));
    expect(screen.queryByRole('heading', { name: '子代理' })).not.toBeInTheDocument();
  });

  it('restores the previous language when persistence fails', async () => {
    const saveGeneral = jest.fn(async () => { throw new Error('save failed'); });
    const i18n = createI18n();
    render(withTestPresentationPlatform(<I18nProvider i18n={i18n}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'zh-CN' } });
    expect(screen.getByText('语言')).toBeInTheDocument();
    await act(async () => undefined);

    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  });

  it('uses the concise session-file delete action', () => {
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} /></I18nProvider>));

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete removed files' })).not.toBeInTheDocument();
  });

  it('maps Top and Bottom labels to the existing tab position values', async () => {
    const saveGeneral = jest.fn(async () => undefined);
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));
    const row = screen.getByText('Tab bar position').closest('.pivi-setting-row');
    const select = within(row as HTMLElement).getByRole('combobox');
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Top', 'Bottom']);
    fireEvent.change(select, { target: { value: 'header' } });
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenCalledWith({ tabBarPosition: 'header' });
  });

  it('normalizes excluded tags into removable badges', async () => {
    const saveGeneral = jest.fn(async () => undefined);
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts({ saveGeneral })} /></I18nProvider>));
    const input = screen.getByRole('textbox', { name: 'Add an excluded tag' });
    fireEvent.change(input, { target: { value: '##private' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenCalledWith({ excludedTags: ['private'] });
    expect(screen.getByText('private', { selector: '.pivi-settings-badge__text' })).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { getData: () => 'public\ndraft' } });
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenLastCalledWith({ excludedTags: ['private', 'public', 'draft'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove excluded tag private' }));
    await act(async () => undefined);
    expect(saveGeneral).toHaveBeenLastCalledWith({ excludedTags: ['public', 'draft'] });
  });

  it('uses the shared Settings control style without applying it to toggles', () => {
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts()} /></I18nProvider>));
    for (const control of container.querySelectorAll('input:not([type="checkbox"]):not([type="range"]), textarea, select')) {
      expect(control).toHaveClass('pivi-settings-control');
    }
    expect(container.querySelector('input[type="checkbox"]')).not.toHaveClass('pivi-settings-control');
    expect(container.querySelector('input[type="range"]')).not.toBeInTheDocument();
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
    const runAction = jest.fn(async () => ({ feedback: { kind: 'success' as const, message: 'Host integration complete.' } }));
    const ports = createPorts();
    ports.hostIntegrations = {
      listSections: async () => [{
        id: 'obsidian:style-settings',
        heading: 'Style Settings',
        description: 'Connect Pivi to the note host.',
        actions: [{ id: 'host:connect', label: 'Connect' }, { id: 'host:configure', label: 'Configure' }],
      }],
      runAction,
    };
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="general" /></I18nProvider>));
    const styleHeading = await screen.findByRole('heading', { name: 'Style Settings' });
    expect(styleHeading).toHaveClass('pivi-settings-section-heading');
    await screen.findByText('Connect Pivi to the note host.');
    const integrationSetting = container.querySelector<HTMLElement>('.pivi-integration-setting.pivi-setting-stack');
    expect(integrationSetting).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => undefined);
    expect(runAction).toHaveBeenCalledWith('host:connect');
    expect(ports.feedback.notify).toHaveBeenCalledWith('Host integration complete.');
  });

  it('renders unavailable host integration actions as disabled with their reason', async () => {
    const ports = createPorts();
    ports.hostIntegrations = {
      listSections: async () => [{
        id: 'obsidian:style-settings',
        heading: 'Style Settings',
        description: 'Connect Pivi to the note host.',
        actions: [{ id: 'host:connect', label: 'Connect', disabled: true, disabledReason: 'Install the host extension first.' }],
      }],
      runAction: async () => ({}),
    };
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="general" /></I18nProvider>));

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

  it('keeps the official skills action visible and changes install to update', async () => {
    let installed = false;
    const install = jest.fn(async () => { installed = true; });
    const update = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.skills.featuredBundle, {
      isInstalled: () => installed,
      install,
      update,
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="skills" /></I18nProvider>));
    fireEvent.click(screen.getByRole('button', { name: 'Install official skills' }));
    await act(async () => undefined);
    expect(install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Update official skills' }));
    await act(async () => undefined);
    expect(update).toHaveBeenCalledTimes(1);
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
  it('orders Local, OAuth, API, and Custom API groups and keeps added OAuth providers visible', () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      getSettings: () => ({ addedProviders: ['openai-codex', 'grok-build'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
      listAddableBuiltinProviders: () => [
        { id: 'anthropic', name: 'Anthropic', logoSlug: null },
        { id: 'claude', name: 'Claude', logoSlug: null },
      ],
      listAddableLocalKinds: () => [{ kind: 'ollama', name: 'Ollama', logoSlug: null }],
      listCustomKinds: () => [{ kind: 'openai-compatible', name: 'OpenAI-compatible', logoSlug: null }],
      getProviderDisplayName: (id: string) => ({
        'openai-codex': 'OpenAI Codex',
        'grok-build': 'Grok Build',
        claude: 'Claude',
      }[id] ?? id),
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    fireEvent.click(screen.getByRole('button', { name: '+ Add provider' }));

    const sections = [...container.querySelectorAll('.pivi-provider-add-section')]
      .map(element => element.textContent);
    expect(sections).toEqual(['Local', 'OAuth', 'API', 'Custom API']);
    expect(screen.getByText('OAuth').parentElement).toHaveTextContent('OpenAI Codex');
    expect(screen.getByText('OAuth').parentElement).toHaveTextContent('Grok Build');
    expect(screen.getByText('OAuth').parentElement).toHaveTextContent('Claude');
    expect(screen.getAllByText('Added')).toHaveLength(2);
    expect(screen.getByText('API').nextElementSibling).toHaveTextContent('Anthropic');
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
    expect(ports.feedback.notify).toHaveBeenCalledWith('Unable to save provider order');
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
    const loginProviderOAuth = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      setApiKey,
      clearCredential,
      loginProviderOAuth,
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect' }).at(-1)!);
    await act(async () => undefined);
    expect(loginProviderOAuth).toHaveBeenCalledWith('openai-codex', expect.any(Function));
  });
  it('keeps Codex actions below the sign-in guidance', () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      hasProviderOAuth: () => true,
      getSettings: () => ({ addedProviders: ['openai-codex'], disabledProviders: [], customProviders: [], visibleModels: [], availableModes: [], discoveredModels: [], environmentVariables: '', selectedMode: '' }),
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    const codexSetting = container.querySelector<HTMLElement>('.pivi-provider-oauth-setting');
    expect(codexSetting).not.toBeNull();
    expect(within(codexSetting!).getByText('Sign in with your ChatGPT/Codex subscription. Credentials are stored in secure storage.')).toBeInTheDocument();
    expect(within(codexSetting!).queryByText(/auth\.json/)).toBeNull();
    expect(within(codexSetting!).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });
  it('rechecks OAuth credentials when a provider is disabled or enabled', async () => {
    const ensureProviderCredentials = jest.fn(async () => undefined);
    const settings = {
      addedProviders: ['openai-codex'],
      disabledProviders: [] as string[],
      customProviders: [],
      visibleModels: [],
      availableModes: [],
      discoveredModels: [],
      environmentVariables: '',
      selectedMode: '',
    };
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      ensureProviderCredentials,
      getSettings: () => ({ ...settings, disabledProviders: [...settings.disabledProviders] }),
      saveSettings: async (patch: { disabledProviders?: string[] }) => {
        if (patch.disabledProviders) settings.disabledProviders = [...patch.disabledProviders];
      },
    });

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <SettingsRoot ports={ports} initialTab="models" />
      </I18nProvider>,
    ));
    await act(async () => undefined);
    expect(ensureProviderCredentials).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Disable openai-codex provider' }));
    await act(async () => undefined);
    expect(ensureProviderCredentials).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable openai-codex provider' }));
    await act(async () => undefined);
    expect(ensureProviderCredentials).toHaveBeenCalledTimes(3);
  });
  it('calls Grok Build OAuth connect from an expanded provider card', async () => {
    const loginProviderOAuth = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      loginProviderOAuth,
      getSettings: () => ({
        addedProviders: ['grok-build'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'grok-build' ? 'Grok Build' : id),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Grok Build', { selector: '.pivi-provider-title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => undefined);
    expect(loginProviderOAuth).toHaveBeenCalledWith('grok-build', expect.any(Function));
  });
  it('lists Grok Build models under the Grok Build provider identity', () => {
    const listModelsForProvider = jest.fn((providerId: string) => (
      providerId === 'grok-build'
        ? [{ value: 'grok-build/grok-4.5', label: 'Grok 4.5', description: 'Standard model' }]
        : []
    ));
    const ports = createPorts();
    Object.assign(ports.catalog, { listModelsForProvider });
    Object.assign(ports.complex.models, {
      getSettings: () => ({
        addedProviders: ['grok-build'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'grok-build' ? 'Grok Build' : id),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Grok Build', { selector: '.pivi-provider-title' }));
    expect(listModelsForProvider).toHaveBeenCalledWith('grok-build');
    expect(screen.getByText('Grok 4.5')).toBeInTheDocument();
  });
  it('renders Anthropic API key controls without manual OAuth token UI', async () => {
    const loginProviderOAuth = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      loginProviderOAuth,
      getSettings: () => ({
        addedProviders: ['anthropic'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'anthropic' ? 'Anthropic' : id),
      getProviderEnvInfo: () => ({ apiKeyVar: 'ANTHROPIC_API_KEY', oauthVar: 'ANTHROPIC_OAUTH_TOKEN' }),
    });
    const { container } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Anthropic'));
    expect(container.querySelector('.pivi-cred-row')).not.toBeNull();
    expect(screen.queryByText('OAuth token')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });
  it('renders Claude OAuth connect on the Claude provider card', async () => {
    const loginProviderOAuth = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      loginProviderOAuth,
      getSettings: () => ({
        addedProviders: ['claude'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'claude' ? 'Claude' : id),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Claude', { selector: '.pivi-provider-title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => undefined);
    expect(loginProviderOAuth).toHaveBeenCalledWith('claude', expect.any(Function));
  });
  it('lists Claude models under the Claude provider identity', () => {
    const listModelsForProvider = jest.fn((providerId: string) => (
      providerId === 'claude'
        ? [{ value: 'claude/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Standard model' }]
        : []
    ));
    const ports = createPorts();
    Object.assign(ports.catalog, { listModelsForProvider });
    Object.assign(ports.complex.models, {
      getSettings: () => ({
        addedProviders: ['claude'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'claude' ? 'Claude' : id),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Claude', { selector: '.pivi-provider-title' }));
    expect(listModelsForProvider).toHaveBeenCalledWith('claude');
    expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument();
  });
  it('shows the device code and cancel control during xAI OAuth login', async () => {
    let progressHandler: ((progress: { kind: string; userCode?: string }) => void) | undefined;
    let resolveLogin!: () => void;
    const cancelProviderOAuthLogin = jest.fn();
    const loginProviderOAuth = jest.fn((_providerId, onProgress) => new Promise<void>((resolve) => {
      progressHandler = onProgress;
      resolveLogin = resolve;
    }));
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      loginProviderOAuth,
      cancelProviderOAuthLogin,
      getSettings: () => ({
        addedProviders: ['grok-build'],
        disabledProviders: [],
        customProviders: [],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
      getProviderDisplayName: (id: string) => (id === 'grok-build' ? 'Grok Build' : id),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Grok Build', { selector: '.pivi-provider-title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await act(async () => {
      progressHandler?.({ kind: 'device_code', userCode: 'WXYZ-9876' });
    });
    expect(screen.getByText('WXYZ-9876')).toBeInTheDocument();
    expect(screen.getByText('Device code')).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);
    expect(cancelProviderOAuthLogin).toHaveBeenCalledWith('grok-build');
    await act(async () => {
      resolveLogin();
    });
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
  it('places optional local API key directly below Base URL without an authentication section', () => {
    const ports = createPorts();
    Object.assign(ports.complex.models, {
      getSettings: () => ({
        addedProviders: ['ollama'],
        disabledProviders: [],
        customProviders: [{
          id: 'ollama',
          kind: 'ollama',
          name: 'Ollama',
          baseUrl: 'http://127.0.0.1:11434',
          api: 'openai-completions',
          apiKeyRequired: false,
          models: [],
        }],
        visibleModels: [],
        availableModes: [],
        discoveredModels: [],
        environmentVariables: '',
        selectedMode: '',
      }),
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));
    fireEvent.click(screen.getByText('Ollama'));
    const card = screen.getByText('Ollama').closest('details');
    expect(card).not.toBeNull();
    const baseUrl = within(card!).getByText('Base URL');
    const apiKey = within(card!).getByText('API key (optional)');
    expect(baseUrl.compareDocumentPosition(apiKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card!).queryByText('Authentication (optional)')).toBeNull();
  });
  it('confirms provider removal and keeps credentials by default', async () => {
    const removeProvider = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.models, { removeProvider });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="models" /></I18nProvider>));

    fireEvent.click(screen.getByRole('button', { name: 'Remove openai provider' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Remove openai provider' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove openai provider?' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await act(async () => undefined);

    expect(removeProvider).toHaveBeenCalledWith('openai', true);
  });
  it('disables the cleanup action while its async port action is pending', async () => {
    let resolve!: (count: number) => void;
    const purgeDeletedSessionFiles = jest.fn(() => new Promise<number>((resolvePromise) => { resolve = resolvePromise; }));
    const ports = createPorts({ purgeDeletedSessionFiles });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>));
    const button = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Delete removed session files?' });
    const confirmDelete = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDelete);
    expect(confirmDelete).toBeDisabled();
    await act(async () => resolve(3));
    expect(ports.feedback.notify).toHaveBeenCalledWith('Deleted 3 removed session file(s).');
  });

  it('requires Apply before environment changes are persisted', async () => {
    const importEnvironmentText = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.environment, {
      listEntries: () => [{ key: 'FOO', scope: 'shared', sourceKind: 'plain', plainValue: 'bar', storageLocation: 'deviceLocal', hasStoredSecret: false }],
      importEnvironmentText,
    });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>));
    const textarea = screen.getByLabelText('Environment variables');
    fireEvent.change(textarea, { target: { value: 'FOO=changed' } });
    fireEvent.blur(textarea);
    expect(importEnvironmentText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await act(async () => undefined);
    expect(importEnvironmentText).toHaveBeenCalledWith('shared', 'FOO=changed');
    expect(screen.getByText('Environment variables saved.')).toBeInTheDocument();
  });

  it('requires confirmation before removing an installed skill', async () => {
    const remove = jest.fn(async () => undefined);
    const ports = createPorts();
    Object.assign(ports.complex.skills, { remove });
    render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="skills" /></I18nProvider>));
    fireEvent.click(screen.getByRole('button', { name: 'Remove skill Example' }));
    expect(remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Remove skill Example?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await act(async () => undefined);
    expect(remove).toHaveBeenCalledWith('example');
    expect(screen.getByText('Example removed.')).toBeInTheDocument();
  });
});
