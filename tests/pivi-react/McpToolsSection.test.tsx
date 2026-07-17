import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ManagedMcpServer, McpAuthStatus } from '@pivi/pivi-agent-core/mcp/types';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = { general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } }, subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 } };

function makePorts(initial: ManagedMcpServer[] = []) {
  let servers = initial;
  const mcp = { load: jest.fn(async () => servers), listTools: jest.fn(async () => [{ name: 'read', description: 'Reads' }, { name: 'search', description: 'Searches' }]), save: jest.fn(async (next: readonly ManagedMcpServer[]) => { servers = [...next]; }), connect: jest.fn(async () => ({ authStatus: 'authenticated' as McpAuthStatus, result: { success: true, tools: [{ name: 'read', description: 'Reads', inputSchema: { type: 'object' } }, { name: 'search', description: 'Searches' }] } })), getAuthStatus: jest.fn(async () => 'not_authenticated'), logout: jest.fn(async () => undefined) };
  const ports: SettingsPorts = { snapshot: { getSnapshot: () => snapshot }, feedback: { notify: jest.fn() }, actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0 }, complex: {
    tools: { getSettings: () => ({ allowBash: false, bashAllowlist: [], allowExternalRead: false, externalReadDirectories: [] }), listToolRows: () => [], setToolEnabled: async () => undefined, chooseExternalDirectory: async () => null, validateExternalDirectory: async () => ({ valid: true }), saveSettings: async () => undefined },
    webSearch: { getSettings: () => ({ providerOrder: [], disabledProviders: [] }), listProviders: () => [], saveSettings: async () => undefined, writeCredential: () => undefined, clearCredential: () => undefined },
    models: { hasCodexAuth: () => false },
    runtime: { refreshPrompt: async () => undefined, refreshModelSelectors: () => undefined },
    mcp,
  } as unknown as SettingsPorts['complex'], persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined }, environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined }, catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) }, hostIntegrations: { listSections: () => [], runAction: async () => ({}) } };
  return { ports, mcp, getServers: () => servers };
}

async function openMcp(ports: SettingsPorts) { render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="tools" /></I18nProvider>)); await act(async () => undefined); }

describe('React MCP settings', () => {
  it('uses a slash marker and reveals tools after opening the provider-style card', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);

    await openMcp(ports);
    await act(async () => undefined);

    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: '+ Add MCP' });
    expect(document.querySelector('.pivi-mcp-container')?.lastElementChild).toContainElement(addButton);
    expect(screen.getByTitle('Slash badges: /remote tokens highlight this server in the composer')).toHaveTextContent('/');
    expect(document.querySelector('.pivi-mcp-context-saving-badge')).not.toHaveTextContent('@');
    expect(screen.getByText('2 tools')).toBeInTheDocument();
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' }));
    await act(async () => undefined);
    expect(screen.getByText('read', { selector: '.pivi-mcp-tool-name' })).toBeInTheDocument();
    expect(screen.getByText('search', { selector: '.pivi-mcp-tool-name' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'MCP servers' }).closest('section')!).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mcp.connect).not.toHaveBeenCalled();
    expect(mcp.listTools).toHaveBeenCalledWith('remote');
  });

  it('keeps enable and remove actions in the header without opening the card', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: true };
    const { ports, getServers } = makePorts([server]);
    await openMcp(ports);
    await act(async () => undefined);

    const card = document.querySelector('.pivi-mcp-card') as HTMLDetailsElement;
    const header = card.querySelector('.pivi-mcp-card-header');
    expect(header).toContainElement(screen.getByRole('button', { name: 'Disable' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Remove' }));

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await act(async () => undefined);
    expect(card).not.toHaveAttribute('open');
    expect(getServers()[0]?.enabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('validates, creates, edits, deletes, and imports MCP servers', async () => {
    const { ports, mcp, getServers } = makePorts(); await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' })); fireEvent.click(screen.getByText('stdio (local command)')); fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a server name');
    fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'local' } }); fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx mcp-server' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); await act(async () => undefined); expect(getServers()).toHaveLength(1);
    fireEvent.click(screen.getByText('local', { selector: '.pivi-mcp-name' })); await act(async () => undefined); expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument(); const inlineEditor = document.querySelector('.pivi-mcp-inline-editor'); expect(inlineEditor).toContainElement(screen.getByRole('button', { name: 'Connect / refresh tools' })); expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(); fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'renamed' } }); fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' })); await act(async () => undefined); expect(getServers()[0]?.name).toBe('renamed'); expect(mcp.connect).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' })); expect(getServers()).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Delete' })); await act(async () => undefined); expect(getServers()).toHaveLength(0);
    const readText = jest.fn(async () => '{"mcpServers":{"unwanted":{"command":"node"}}}');
    Object.assign(navigator, { clipboard: { readText } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    const importDialog = screen.getByRole('dialog', { name: 'Import MCP configuration' });
    fireEvent.change(within(importDialog).getByLabelText('MCP configuration JSON'), {
      target: { value: '{"mcpServers":{"imported":{"command":"node","args":["server.js"]}}}' },
    });
    fireEvent.click(within(importDialog).getByRole('button', { name: 'Import' }));
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
    let dialog = screen.getByRole('dialog', { name: 'Import MCP configuration' });
    fireEvent.change(within(dialog).getByLabelText('MCP configuration JSON'), {
      target: { value: 'not json' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('No valid MCP configuration found in pasted JSON');
    expect(mcp.save).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('MCP configuration JSON'), {
      target: {
        value: '{"mcpServers":{"existing":{"command":"node"},"added":{"type":"http","url":"https://example.test/mcp"}}}',
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await act(async () => undefined);
    expect(getServers().map((server) => server.name)).toEqual(['existing', 'added']);
    expect(screen.queryByRole('dialog', { name: 'Import MCP configuration' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    dialog = screen.getByRole('dialog', { name: 'Import MCP configuration' });
    const textarea = within(dialog).getByLabelText('MCP configuration JSON');
    expect(textarea).toHaveFocus();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Import MCP configuration' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' }));
    fireEvent.click(screen.getByText('Import JSON'));
    dialog = screen.getByRole('dialog', { name: 'Import MCP configuration' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Import MCP configuration' })).not.toBeInTheDocument();
    expect(getServers().map((server) => server.name)).toEqual(['existing', 'added']);
  });
  it('preserves HTTP auth and header editor fields', async () => {
    const { ports, getServers } = makePorts(); await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: '+ Add MCP' })); fireEvent.click(screen.getByText('http / sse (remote)')); expect(screen.getByRole('option', { name: 'Stdio' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'SSE' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'HTTP' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Auto' })).toBeInTheDocument(); expect(screen.getAllByRole('combobox').every((select) => select.classList.contains('pivi-select'))).toBe(true); fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'remote' } }); fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'http' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); expect(screen.getByRole('alert')).toHaveTextContent('Please enter a URL');
    fireEvent.change(screen.getByPlaceholderText('http://localhost:3000/sse'), { target: { value: 'https://example.test/mcp' } }); expect(screen.getByLabelText('Headers').closest('label')).toHaveClass('pivi-mcp-editor-field-headers'); fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'Authorization=Bearer token' } }); fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'oauth' } }); fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); await act(async () => undefined);
    expect(screen.queryByLabelText('Composer slash badges')).not.toBeInTheDocument();
    expect(getServers()[0]).toMatchObject({ name: 'remote', config: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' } }, auth: 'oauth', oauth: { clientId: 'client' }, contextSaving: true });
  });
  it('saves and connects an OAuth server from one primary action', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } }; const { ports, mcp } = makePorts([server]); await openMcp(ports); await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' })); await act(async () => undefined); expect(screen.queryByRole('button', { name: 'OAuth' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' })); await act(async () => undefined); expect(mcp.save).toHaveBeenCalled(); expect(mcp.connect).toHaveBeenCalledWith(server);
  });
  it('refreshes the read-only tool inventory only when requested', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false };
    const { ports, mcp } = makePorts([server]);
    await openMcp(ports);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' }));
    await act(async () => undefined);

    expect(mcp.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(mcp.connect).toHaveBeenCalledWith(server);
    expect(screen.getByText('Tools refreshed')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'MCP servers' }).closest('section')!).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable all' })).not.toBeInTheDocument();
  });
  it('shows alert when connect or OAuth fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.connect.mockRejectedValueOnce(new Error('OAuth denied'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('OAuth denied');
  });

  it('does not report an auth error when a public MCP needs no OAuth', async () => {
    const server: ManagedMcpServer = { name: 'deepwiki', config: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);
    mcp.connect.mockResolvedValueOnce({ authStatus: 'not_applicable', result: { success: true, tools: [] } });
    await openMcp(ports);
    await act(async () => undefined);

    fireEvent.click(screen.getByText('deepwiki', { selector: '.pivi-mcp-name' }));
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
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect / refresh tools' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('Auth failed for "remote"');
  });

  it('shows alert when OAuth logout fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.getAuthStatus.mockResolvedValueOnce('authenticated');
    mcp.logout.mockRejectedValueOnce(new Error('logout failed'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByText('remote', { selector: '.pivi-mcp-name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear OAuth credentials' }));
    await act(async () => undefined);
    expect(ports.feedback.notify).toHaveBeenCalledWith('logout failed');
  });

  it('does not update after an unmounted asynchronous load resolves', async () => {
    // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+
    const { promise, resolve } = Promise.withResolvers<readonly ManagedMcpServer[]>(); const { ports } = makePorts(); ports.complex.mcp.load = jest.fn(() => promise); const rendered = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="tools" /></I18nProvider>)); rendered.unmount(); await act(async () => resolve([{ name: 'late', config: { command: 'node' }, enabled: true, contextSaving: false }])); expect(screen.queryByText('late')).not.toBeInTheDocument();
  });
});
