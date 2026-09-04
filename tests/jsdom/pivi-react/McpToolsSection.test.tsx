import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ManagedMcpServer, McpAuthStatus } from '@pivi/agent/mcp/types';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = { general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, showCacheHitRate: true, showTokensPerSecond: true, enableAutoTitleGeneration: false, userName: '', excludedTags: [], providerRequestDeadlines: { totalMs: 600_000, idleMs: 120_000 }, requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' }, editorSelectionToolbar: { enabled: true, shortcuts: [] } }, subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 } };

function makePorts(initial: ManagedMcpServer[] = []) {
  let servers = initial;
  const mcp = { load: jest.fn(async () => servers), listTools: jest.fn(async () => [{ name: 'read', description: 'Reads' }, { name: 'search', description: 'Searches' }]), save: jest.fn(async (next: readonly ManagedMcpServer[]) => { servers = [...next]; }), connect: jest.fn(async () => ({ authStatus: 'authenticated' as McpAuthStatus, result: { success: true, tools: [{ name: 'read', description: 'Reads', inputSchema: { type: 'object' } }, { name: 'search', description: 'Searches' }] } })), getAuthStatus: jest.fn(async () => 'not_authenticated'), logout: jest.fn(async () => undefined) };
  const ports: SettingsPorts = { snapshot: { getSnapshot: () => snapshot }, feedback: { notify: jest.fn() }, actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, saveEditorSelectionToolbar: async () => undefined, purgeDeletedSessionFiles: async () => 0 }, complex: {
    tools: { getSettings: () => ({ allowBash: false, bashAllowlist: [], allowExternalRead: false, externalReadDirectories: [] }), listToolRows: () => [], setToolEnabled: async () => undefined, chooseExternalDirectory: async () => null, validateExternalDirectory: async () => ({ valid: true }), saveSettings: async () => undefined },
    webSearch: { getSettings: () => ({ providerOrder: [], disabledProviders: [] }), listProviders: () => [], saveSettings: async () => undefined, writeCredential: () => undefined, clearCredential: () => undefined },
    models: { hasCodexAuth: () => false },
    runtime: { refreshPrompt: async () => undefined, refreshModelSelectors: () => undefined },
    mcp,
  } as unknown as SettingsPorts['complex'], persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined }, environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, importEnvironmentText: async () => undefined, listEntries: () => [], getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined }, editorToolbar: { listHostCommands: () => [], listPiviCommands: async () => [], listIconNames: () => [], isNoteToolbarTextToolbarActive: () => false }, catalog: { listModelsForProvider: () => [], listCatalogModels: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) }, hostIntegrations: { listSections: () => [], runAction: async () => ({}) }, mentionEditor: { mount: () => ({ getValue: () => '', setValue: () => undefined, focus: () => undefined, setDisabled: () => undefined, destroy: () => undefined }) }, about: { getSnapshot: () => ({ version: '0.19.4', releasedAt: '2026-08-29', githubUrl: 'https://github.com/shuuul/obsidian-pivi', issuesUrl: 'https://github.com/shuuul/obsidian-pivi/issues' }) }, prompt: { getCatalogRevision: () => 1, listModules: () => [], getUsage: () => ({ sections: [], totalEstimatedTokens: 0 }), setWorkflowEnabled: async () => undefined, saveCustomBody: async () => undefined, restoreShipped: async () => undefined, createCustomModule: async () => ({ id: 'custom:x', kind: 'custom', title: 'New', enabled: true, modified: false, body: '' }), renameCustomModule: async () => undefined, editCustomModule: async () => undefined, reorderCustomModules: async () => undefined, setCustomModuleEnabled: async () => undefined, deleteCustomModule: async () => undefined } };
  return { ports, mcp, getServers: () => servers };
}

async function openMcp(ports: SettingsPorts) { render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} page="mcpServers" /></I18nProvider>)); await act(async () => undefined); }

describe('React MCP settings', () => {
  it('uses a slash marker and reveals tools after opening the provider-style card', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);

    await openMcp(ports);
    await act(async () => undefined);

    const addButton = screen.getByRole('button', { name: '+ Add MCP' });
    expect(addButton.closest('.pivi-settings-collection')).toBeNull();
    expect(screen.getByTitle('Slash badges: /remote tokens highlight this server in the composer')).toHaveTextContent('Slash mention');
    expect(screen.getByTitle('Slash badges: /remote tokens highlight this server in the composer')).not.toHaveTextContent('@');
    const summary = screen.getByText('2 tools').closest('.pivi-settings-card__summary');
    expect(summary).toHaveTextContent('2 tools');
    expect(summary).toHaveTextContent('https://example.test/mcp');
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' }));
    await act(async () => undefined);
    expect(screen.getByText('read', { selector: '.pivi-mcp-tool-name' })).toBeInTheDocument();
    expect(screen.getByText('search', { selector: '.pivi-mcp-tool-name' })).toBeInTheDocument();
    const cardBody = document.querySelector('.pivi-settings-card__body');
    expect(cardBody).not.toBeNull();
    expect(within(cardBody as HTMLElement).queryByText('https://example.test/mcp', { selector: 'p' })).not.toBeInTheDocument();
    expect(within(cardBody as HTMLElement).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mcp.connect).not.toHaveBeenCalled();
    expect(mcp.listTools).toHaveBeenCalledWith('remote');
  });

  it('keeps enable and remove actions in the header without opening the card', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: true };
    const { ports, getServers } = makePorts([server]);
    await openMcp(ports);
    await act(async () => undefined);

    const card = document.querySelector('.pivi-settings-card') as HTMLElement;
    const header = card.querySelector('.pivi-settings-card__header');
    expect(header).toContainElement(screen.getByRole('checkbox', { name: 'Disable MCP server remote' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Remove MCP server remote' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Disable MCP server remote' }));
    await act(async () => undefined);
    expect(card).not.toHaveClass('is-open');
    expect(getServers()[0]?.enabled).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Enable MCP server remote' })).toBeInTheDocument();
  });

  it('validates, creates, edits, deletes, and imports MCP servers', async () => {
    const { ports, mcp, getServers } = makePorts(); await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' })); fireEvent.click(screen.getByText('stdio (local command)')); fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a server name');
    fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'local' } }); fireEvent.change(screen.getByLabelText('Executable'), { target: { value: 'npx' } }); fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'mcp-server' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); await act(async () => undefined); expect(getServers()).toHaveLength(1);
    fireEvent.click(screen.getByText('local', { selector: '.pivi-settings-card__name' })); await act(async () => undefined); expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument(); const inlineEditor = document.querySelector('.pivi-mcp-inline-editor'); expect(inlineEditor).toContainElement(screen.getByRole('button', { name: 'Connect / refresh tools' })); expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument(); fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'renamed' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(document.querySelector('.pivi-settings-card')).not.toHaveClass('is-open')); expect(getServers()[0]?.name).toBe('renamed'); expect(mcp.connect).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove MCP server renamed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' })); await act(async () => undefined); expect(getServers()).toHaveLength(0);
    const readText = jest.fn(async () => '{"mcpServers":{"unwanted":{"command":"node"}}}');
    Object.assign(navigator, { clipboard: { readText } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    expect(screen.queryByRole('dialog', { name: 'Import MCP configuration' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('MCP configuration JSON'), {
      target: { value: '{"mcpServers":{"imported":{"command":"node","args":["server.js"]}}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await act(async () => undefined);
    expect(readText).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('my-mcp-server')).toHaveValue('imported');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await act(async () => undefined);
    expect(getServers()[0]?.name).toBe('imported');
    expect(mcp.save).toHaveBeenCalled();
  });

  it('validates, cancels, and de-duplicates explicit JSON imports', async () => {
    const existing: ManagedMcpServer = {
      name: 'existing',
      config: { command: 'node', args: ['existing.js'] },
      enabled: true,
      contextSaving: true,
    };
    const { ports, mcp, getServers } = makePorts([existing]);
    await openMcp(ports);

    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    let textarea = screen.getByLabelText('MCP configuration JSON');
    fireEvent.change(textarea, {
      target: { value: 'not json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('No valid MCP configuration found in pasted JSON');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mcp.save).not.toHaveBeenCalled();

    fireEvent.change(textarea, {
      target: {
        value: '{"mcpServers":{"existing":{"command":"node"},"added":{"type":"http","url":"https://example.test/mcp"}}}',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await act(async () => undefined);
    expect(getServers().map((server) => server.name)).toEqual(['existing', 'added']);
    expect(screen.queryByRole('dialog', { name: 'Import MCP configuration' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    textarea = screen.getByLabelText('MCP configuration JSON');
    expect(textarea).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('MCP configuration JSON')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('MCP configuration JSON')).not.toBeInTheDocument();
    expect(getServers().map((server) => server.name)).toEqual(['existing', 'added']);
  });
  it('preserves HTTP auth and header editor fields', async () => {
    const { ports, getServers } = makePorts();
    await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('http / sse (remote)'));
    const editor = document.querySelector('.pivi-mcp-inline-editor') as HTMLElement;
    fireEvent.click(within(editor).getByLabelText('Type'));
    expect(screen.getByRole('option', { name: 'Stdio' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SSE' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'HTTP' })).toBeInTheDocument();
    expect(within(editor).getByLabelText('Type')).toHaveClass('pivi-select');
    expect(within(editor).getByLabelText('Authentication')).toHaveClass('pivi-select');
    fireEvent.change(within(editor).getByPlaceholderText('my-mcp-server'), { target: { value: 'remote' } });
    fireEvent.click(screen.getByRole('option', { name: 'HTTP' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Add' }));
    expect(within(editor).getByRole('alert')).toHaveTextContent('Please enter a URL');
    fireEvent.change(within(editor).getByPlaceholderText('http://localhost:3000/sse'), { target: { value: 'https://example.test/mcp' } });
    const headersLabel = within(editor).getByText('Headers');
    fireEvent.change(headersLabel.closest('.pivi-settings-row')!.querySelector('textarea')!, { target: { value: 'Authorization=Bearer token' } });
    fireEvent.click(within(editor).getByLabelText('Authentication'));
    expect(screen.getByRole('option', { name: 'Auto' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'OAuth' }));
    fireEvent.change(within(editor).getByLabelText('Client ID'), { target: { value: 'client' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Add' }));
    await act(async () => undefined);
    expect(screen.queryByLabelText('Composer slash badges')).not.toBeInTheDocument();
    expect(getServers()[0]).toMatchObject({ name: 'remote', config: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' } }, auth: 'oauth', oauth: { clientId: 'client' }, contextSaving: true });
  });
  it('saves and connects an OAuth server from one primary action', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } }; const { ports, mcp } = makePorts([server]); await openMcp(ports); await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' })); await act(async () => undefined); expect(screen.queryByRole('button', { name: 'OAuth' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' })); await act(async () => undefined); expect(mcp.save).toHaveBeenCalled(); expect(mcp.connect).toHaveBeenCalledWith(server);
  });
  it('refreshes the read-only tool inventory only when requested', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false };
    const { ports, mcp } = makePorts([server]);
    await openMcp(ports);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' }));
    await act(async () => undefined);

    expect(mcp.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(mcp.connect).toHaveBeenCalledWith(server);
    expect(ports.feedback.notify).toHaveBeenCalledWith('Tools refreshed');
    expect(screen.queryByText('Tools refreshed')).not.toBeInTheDocument();
    const cardBody = document.querySelector('.pivi-settings-card__body');
    expect(cardBody).not.toBeNull();
    expect(within(cardBody as HTMLElement).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable all' })).not.toBeInTheDocument();
  });
  it('shows alert when connect or OAuth fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.connect.mockRejectedValueOnce(new Error('OAuth denied'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('OAuth denied');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not report an auth error when a public MCP needs no OAuth', async () => {
    const server: ManagedMcpServer = { name: 'deepwiki', config: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);
    mcp.connect.mockResolvedValueOnce({ authStatus: 'not_applicable', result: { success: true, tools: [] } });
    await openMcp(ports);
    await act(async () => undefined);

    fireEvent.click(screen.getByText('deepwiki', { selector: '.pivi-settings-card__name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);

    expect(mcp.connect).toHaveBeenCalledWith(server);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows authFailed fallback when OAuth authenticate fails without message', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.connect.mockRejectedValueOnce(new Error(''));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('Auth failed for "remote"');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows alert when OAuth logout fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.getAuthStatus.mockResolvedValueOnce('authenticated');
    mcp.logout.mockRejectedValueOnce(new Error('logout failed'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-settings-card__name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear OAuth credentials' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('logout failed');
  });

  it('does not update after an unmounted asynchronous load resolves', async () => {
    // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+
    const { promise, resolve } = Promise.withResolvers<readonly ManagedMcpServer[]>(); const { ports } = makePorts(); ports.complex.mcp.load = jest.fn(() => promise); const rendered = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} page="mcpServers" /></I18nProvider>)); rendered.unmount(); await act(async () => resolve([{ name: 'late', config: { command: 'node' }, enabled: true, contextSaving: false }])); expect(screen.queryByText('late')).not.toBeInTheDocument();
  });
});
