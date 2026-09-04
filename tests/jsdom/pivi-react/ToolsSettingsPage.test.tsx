import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, showCacheHitRate: true, showTokensPerSecond: true, enableAutoTitleGeneration: false, userName: '', excludedTags: [], providerRequestDeadlines: { totalMs: 600_000, idleMs: 120_000 }, requireCommandOrControlEnterToSend: false, editorSelectionToolbar: { enabled: true, shortcuts: [] } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createPorts(overrides: Partial<SettingsPorts['complex']['tools']> = {}): SettingsPorts {
  const settings = { allowBash: false, bashAllowlist: [] as readonly string[], allowExternalRead: false, externalReadDirectories: [] as readonly string[], defaultReadMaxChars: 100_000 };
  return {
    snapshot: { getSnapshot: () => snapshot },
    feedback: { notify: jest.fn() },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, saveEditorSelectionToolbar: async () => undefined, purgeDeletedSessionFiles: async () => 0 },
    complex: {
      tools: { getSettings: () => settings, listToolRows: () => [
        { name: 'obsidian_read', label: 'Read', description: 'Read notes', group: 'workspace-api', configuration: 'read', enabled: true, available: true },
        { name: 'host_tool', label: 'Host tool', description: 'Host capability', group: 'workspace-api', enabled: false, available: true },
        { name: 'obsidian_read_external', label: 'Read external', description: 'Read external files', group: 'additional', configuration: 'external-read', enabled: false, available: false },
        { name: 'obsidian_bash', label: 'Bash', description: 'Run bash', group: 'additional', configuration: 'bash', enabled: false, available: true },
      ], setToolEnabled: async () => undefined, chooseExternalDirectory: async () => null, validateExternalDirectory: async () => ({ valid: true }), saveSettings: async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]) => { Object.assign(settings, patch); }, ...overrides },
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
      mcp: {
        load: async () => [],
        listTools: async () => [],
        save: async () => undefined,
        connect: async () => ({ authStatus: 'not_applicable', result: { success: true, tools: [] } }),
        getAuthStatus: async () => 'not_applicable',
        logout: async () => undefined,
      },
      models: { hasCodexAuth: () => false },
      runtime: { refreshPrompt: async () => undefined, refreshModelSelectors: () => undefined },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, importEnvironmentText: async () => undefined, listEntries: () => [], getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    editorToolbar: { listHostCommands: () => [], listPiviCommands: async () => [], listIconNames: () => [], isNoteToolbarTextToolbarActive: () => false },
    catalog: { listModelsForProvider: () => [], listCatalogModels: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: () => [], runAction: async () => ({}) },
    mentionEditor: { mount: () => ({ getValue: () => '', setValue: () => undefined, focus: () => undefined, setDisabled: () => undefined, destroy: () => undefined }) },
    about: { getSnapshot: () => ({ version: '0.19.4', releasedAt: '2026-08-29', githubUrl: 'https://github.com/shuuul/obsidian-pivi', issuesUrl: 'https://github.com/shuuul/obsidian-pivi/issues' }) },
    prompt: {
      getCatalogRevision: () => 1,
      listModules: () => [],
      getUsage: () => ({ sections: [], totalEstimatedTokens: 0 }),
      setWorkflowEnabled: async () => undefined,
      saveCustomBody: async () => undefined,
      restoreShipped: async () => undefined,
      createCustomModule: async () => ({ id: 'custom:x', kind: 'custom', title: 'New', enabled: true, modified: false, body: '' }),
      renameCustomModule: async () => undefined,
      editCustomModule: async () => undefined,
      reorderCustomModules: async () => undefined,
      setCustomModuleEnabled: async () => undefined,
      deleteCustomModule: async () => undefined,
    },
  };
}

function renderPage(ports: SettingsPorts, page: 'builtInTools' | 'webTools' | 'mcpServers' = 'builtInTools') {
  return render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot page={page} ports={ports} /></I18nProvider>));
}

function renderTools(ports: SettingsPorts) {
  return renderPage(ports, 'builtInTools');
}

function renderWebTools(ports: SettingsPorts) {
  return renderPage(ports, 'webTools');
}

describe('React tools settings', () => {
  it('renders built-in tools, web tools, and MCP servers as separate pages', async () => {
    const ports = createPorts();
    const builtIn = renderPage(ports, 'builtInTools');
    await act(async () => undefined);
    expect(screen.queryByRole('heading', { name: 'Tool toggles' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Subagents' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable spawn_agent' })).toBeInTheDocument();
    builtIn.unmount();

    const web = renderPage(ports, 'webTools');
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: /Reorder Brave Search/ })).toBeInTheDocument();
    web.unmount();

    const mcp = renderPage(ports, 'mcpServers');
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: /Add MCP/ })).toBeInTheDocument();
    mcp.unmount();
  });

  it('stacks external directory controls below their description', () => {
    renderTools(createPorts());
    const setting = screen.getByText('Allowed external directories').closest<HTMLElement>('.pivi-settings-row');
    expect(setting).not.toBeNull();
    expect(setting).toHaveClass('pivi-settings-row--stacked');
    expect(within(setting!).getByText('Allowed external directories')).toBeInTheDocument();
    expect(within(setting!).getByRole('textbox')).toBeInTheDocument();
    expect(within(setting!).getByRole('button', { name: 'Browse' })).toBeInTheDocument();
  });

  it('delegates host tool availability changes through the tools port', async () => {
    const setToolEnabled = jest.fn(async () => undefined);
    const ports = createPorts({ setToolEnabled });
    renderTools(ports);
    const hostToolToggle = screen.getByRole('checkbox', { name: 'Host tool' });
    expect(hostToolToggle.parentElement).toHaveClass('pivi-toggle');
    expect(hostToolToggle.parentElement).not.toHaveClass('checkbox-container', 'is-enabled', 'is-disabled');
    expect(hostToolToggle).not.toBeChecked();
    fireEvent.click(hostToolToggle);
    await act(async () => undefined);
    expect(setToolEnabled).toHaveBeenCalledWith('host_tool', true);
    expect(screen.getByRole('checkbox', { name: 'Host tool' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Host tool' }).parentElement).toHaveClass('pivi-toggle--enabled');
  });

  it('groups tool toggles by implementation and ownership', () => {
    renderTools(createPorts({
      listToolRows: () => [
        { name: 'api_tool', label: 'API tool', description: 'API capability', group: 'workspace-api', enabled: true, available: true },
        { name: 'cli_tool', label: 'CLI tool', description: 'CLI capability', group: 'host-cli', enabled: true, available: true },
        { name: 'pivi_tool', label: 'Pivi tool', description: 'Pivi capability', group: 'pivi', enabled: true, available: true },
        { name: 'extra_tool', label: 'Extra tool', description: 'Additional capability', group: 'additional', enabled: true, available: true },
      ],
    }));

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Workspace tools',
      'Test host CLI',
      'Pivi',
      'Additional access',
      'Subagents',
    ]);
  });

  it('persists the default read size', async () => {
    const saveSettings = jest.fn(async () => undefined);
    renderTools(createPorts({ saveSettings }));

    const readToggle = screen.getByRole('checkbox', { name: 'Read' });
    expect(readToggle.closest('.pivi-settings-row')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Default read size' }));
    fireEvent.click(screen.getByRole('option', { name: '200k characters' }));
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledWith({ defaultReadMaxChars: 200_000 });
  });

  it('allows main-Agent management tools to be toggled', async () => {
    const setToolEnabled = jest.fn(async () => undefined);
    renderTools(createPorts({
      setToolEnabled,
      listToolRows: () => [
        { name: 'pivi_mcp', label: 'Pivi MCP', description: 'Manage MCP.',
          group: 'pivi', enabled: true, available: true },
        { name: 'pivi_skills', label: 'Pivi Skills', description: 'Manage Skills.',
          group: 'pivi', enabled: true, available: true },
        { name: 'pivi_commands', label: 'Pivi Commands', description: 'Manage Commands.',
          group: 'pivi', enabled: true, available: true },
        { name: 'pivi_prompt', label: 'Pivi Prompt', description: 'Manage Prompt.',
          group: 'pivi', enabled: true, available: true },
      ],
    }));

    for (const label of ['Pivi MCP', 'Pivi Skills', 'Pivi Commands', 'Pivi Prompt']) {
      const toggle = screen.getByRole('checkbox', { name: label });
      expect(toggle).toBeChecked();
      expect(toggle).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pivi MCP' }));
    await act(async () => undefined);
    expect(setToolEnabled).toHaveBeenCalledWith('pivi_mcp', false);
    expect(screen.getByRole('checkbox', { name: 'Pivi MCP' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pivi Skills' })).toBeChecked();
  });

  it('keeps sibling tool toggles enabled while one save is in flight', async () => {
    let resolveSave: (() => void) | undefined;
    const setToolEnabled = jest.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    renderTools(createPorts({
      setToolEnabled,
      listToolRows: () => [
        { name: 'pivi_mcp', label: 'Pivi MCP', description: 'Manage MCP.', group: 'pivi', enabled: true, available: true },
        { name: 'pivi_skills', label: 'Pivi Skills', description: 'Manage Skills.', group: 'pivi', enabled: true, available: true },
      ],
    }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pivi MCP' }));
    expect(screen.getByRole('checkbox', { name: 'Pivi MCP' })).not.toBeChecked();
    const sibling = screen.getByRole('checkbox', { name: 'Pivi Skills' });
    expect(sibling).toBeChecked();
    expect(sibling).toBeEnabled();
    expect(sibling.parentElement).not.toHaveClass('pivi-toggle--disabled');

    await act(async () => {
      resolveSave?.();
    });
    expect(setToolEnabled).toHaveBeenCalledWith('pivi_mcp', false);
  });

  it('adds, deduplicates, and removes Bash command badges', async () => {
    const saveSettings = jest.fn(async () => undefined);
    renderTools(createPorts({ saveSettings }));
    const input = screen.getByRole('textbox', { name: 'Add an allowed bash command' });
    fireEvent.change(input, { target: { value: 'git' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => undefined);
    fireEvent.change(input, { target: { value: 'npm run build' } });
    fireEvent.blur(input);
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenLastCalledWith({ bashAllowlist: ['git', 'npm run build'] });
    expect(screen.getByText('npm run build', { selector: '.pivi-settings-badge__text' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove allowed bash command git' }));
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenLastCalledWith({ bashAllowlist: ['npm run build'] });
  });

  it('keeps a tool toggle unchanged when enabling it fails', async () => {
    const setToolEnabled = jest.fn(async () => {
      throw new Error('save failed');
    });
    renderTools(createPorts({ setToolEnabled }));
    const hostToolToggle = screen.getByRole('checkbox', { name: 'Host tool' });
    expect(hostToolToggle).not.toBeChecked();
    fireEvent.click(hostToolToggle);
    await act(async () => undefined);
    expect(setToolEnabled).toHaveBeenCalledWith('host_tool', true);
    expect(screen.getByRole('checkbox', { name: 'Host tool' })).not.toBeChecked();
  });

  it('keeps unavailable tools disabled and reports invalid external paths', async () => {
    renderTools(createPorts({ listToolRows: () => [
      { name: 'unavailable', label: 'Unavailable host tool', description: 'Requires host support', group: 'additional', enabled: false, available: false },
      { name: 'obsidian_read_external', label: 'Read external', description: 'Read external files', group: 'additional', configuration: 'external-read', enabled: false, available: false },
    ] }));
    expect(screen.getByRole('checkbox', { name: 'Unavailable host tool' })).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Add an allowed external directory' });
    fireEvent.change(input, { target: { value: 'relative/path' } });
    fireEvent.blur(input);
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
  it('preserves Unix and Windows filesystem roots', async () => {
    const saveSettings = jest.fn(async () => undefined);
    renderTools(createPorts({ saveSettings }));
    const input = screen.getByRole('textbox', { name: 'Add an allowed external directory' });
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => undefined);
    fireEvent.change(input, { target: { value: 'C:\\' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenLastCalledWith({ externalReadDirectories: ['/', 'C:/'] });
  });
  it('keeps an unfinished directory draft when Browse is clicked', async () => {
    const saveSettings = jest.fn(async () => undefined);
    const ports = createPorts({ saveSettings });
    ports.complex.tools.chooseExternalDirectory = async () => '/picked';
    renderTools(ports);
    const input = screen.getByRole('textbox', { name: 'Add an allowed external directory' });
    const browse = screen.getByRole('button', { name: 'Browse' });
    fireEvent.change(input, { target: { value: '/manual' } });
    expect(fireEvent.mouseDown(browse)).toBe(false);
    fireEvent.click(browse);
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenCalledWith({ externalReadDirectories: ['/picked'] });
    expect(input).toHaveValue('/manual');
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
    renderWebTools(ports);
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Brave Search/ }));
    const input = screen.getByPlaceholderText('Enter API key...');
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('Error');
    expect(input).not.toBeDisabled();
  });

  it('reorders web providers with the keyboard and saves once on drop', async () => {
    const ports = createPorts();
    const saveSettings = jest.fn(async () => undefined);
    ports.complex.webSearch.saveSettings = saveSettings;
    renderWebTools(ports);
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
    const { container } = renderWebTools(ports);
    const handle = screen.getByRole('button', { name: /Reorder Brave Search/ }) as HTMLButtonElement;
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-settings-sort-id]'));
    for (const card of cards) {
      card.getBoundingClientRect = jest.fn(() => {
        const index = Array.from(card.parentElement?.children ?? []).indexOf(card);
        const match = /translateY\((-?[\d.]+)px\)/.exec(card.style.transform);
        const dragOffset = match ? Number.parseFloat(match[1] ?? '0') : 0;
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
    renderWebTools(ports);
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
    renderWebTools(ports);
    const handle = screen.getByRole('button', { name: /Reorder Brave Search/ });

    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Reorder Brave Search, currently position 2/ })).toBeInTheDocument();
    expect(ports.feedback.notify).toHaveBeenCalledWith('Error');
  });

  it('renders provider brand icons and keeps reorder announcements out of visual layout', () => {
    const { container } = renderWebTools(createPorts());

    expect(container.querySelectorAll('.pivi-settings-card__icon .pivi-provider-logo-mask')).toHaveLength(4);
    expect(container.querySelector('[aria-live="polite"]')).toHaveClass('pivi-visually-hidden');
  });

  it('links web providers to their API key or docs pages', () => {
    renderWebTools(createPorts());
    for (const name of ['Brave Search', 'Tavily', 'Exa', 'AnySearch']) {
      fireEvent.click(screen.getByRole('button', { expanded: false, name: new RegExp(name) }));
    }

    expect([
      screen.getByRole('link', { name: 'Get API key at brave.com' }),
      screen.getByRole('link', { name: 'Get API key at app.tavily.com' }),
      screen.getByRole('link', { name: 'Get API key at dashboard.exa.ai' }),
      screen.getByRole('link', { name: 'Get API key at anysearch.com' }),
    ].map(link => link.getAttribute('href'))).toEqual([
      'https://brave.com/search/api/',
      'https://app.tavily.com/home',
      'https://dashboard.exa.ai/api-keys',
      'https://anysearch.com/console/api-keys',
    ]);
  });
});
