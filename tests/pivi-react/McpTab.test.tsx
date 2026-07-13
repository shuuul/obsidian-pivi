import { act, fireEvent, render, screen } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

const snapshot: SettingsUiSnapshotData = { general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true, autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } }, subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 } };

function makePorts(initial: ManagedMcpServer[] = []) {
  let servers = initial;
  const mcp = { load: jest.fn(async () => servers), listTools: jest.fn(async () => [{ name: 'read', description: 'Reads' }, { name: 'search', description: 'Searches' }]), save: jest.fn(async (next: readonly ManagedMcpServer[]) => { servers = [...next]; }), reload: jest.fn(async () => undefined), test: jest.fn(async () => ({ success: true, tools: [{ name: 'read', description: 'Reads' }, { name: 'search', description: 'Searches' }] })), getAuthStatus: jest.fn(async () => 'authenticated'), authenticate: jest.fn(async () => 'authenticated'), logout: jest.fn(async () => undefined) };
  const ports: SettingsPorts = { snapshot: { getSnapshot: () => snapshot }, actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0 }, complex: { mcp } as unknown as SettingsPorts['complex'], persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined }, environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined }, catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) }, hostIntegrations: { listSections: () => [], runAction: async () => ({}) } };
  return { ports, mcp, getServers: () => servers };
}

async function openMcp(ports: SettingsPorts) { render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} /></I18nProvider>)); fireEvent.click(screen.getByRole('tab', { name: 'MCPs' })); await act(async () => undefined); }

describe('React MCP settings', () => {
  it('uses a slash marker and lists selector tools as badges on the server card', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);

    await openMcp(ports);
    await act(async () => undefined);

    expect(screen.getByTitle('Slash badges: /remote tokens highlight this server in the composer')).toHaveTextContent('/');
    expect(document.querySelector('.pivi-mcp-context-saving-badge')).not.toHaveTextContent('@');
    expect(document.querySelectorAll('.pivi-mcp-tool-badge')).toHaveLength(2);
    expect(screen.getByText('read', { selector: '.pivi-mcp-tool-badge' })).toHaveAttribute('title', 'Reads');
    expect(screen.getByText('search', { selector: '.pivi-mcp-tool-badge' })).toHaveAttribute('title', 'Searches');
    expect(mcp.listTools).toHaveBeenCalledWith('remote');
  });

  it('validates, creates, edits, deletes, and imports MCP servers', async () => {
    const { ports, mcp, getServers } = makePorts(); await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Add' })); fireEvent.click(screen.getByText('stdio (local command)')); fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!);
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a server name');
    fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'local' } }); fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx mcp-server' } }); fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!); await act(async () => undefined); expect(getServers()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' })); fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'renamed' } }); fireEvent.click(screen.getByRole('button', { name: 'Update' })); await act(async () => undefined); expect(getServers()[0]?.name).toBe('renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' })); expect(getServers()).toHaveLength(1); fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!); await act(async () => undefined); expect(getServers()).toHaveLength(0);
    Object.assign(navigator, { clipboard: { readText: jest.fn(async () => '{"mcpServers":{"imported":{"command":"node","args":["server.js"]}}}') } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); fireEvent.click(screen.getByText('Import from clipboard')); await act(async () => undefined); expect(screen.getByPlaceholderText('my-mcp-server')).toHaveValue('imported'); fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!); await act(async () => undefined); expect(getServers()[0]?.name).toBe('imported'); expect(mcp.save).toHaveBeenCalled();
  });
  it('preserves HTTP auth and header editor fields', async () => {
    const { ports, getServers } = makePorts(); await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Add' })); fireEvent.click(screen.getByText('http / sse (remote)')); fireEvent.change(screen.getByPlaceholderText('my-mcp-server'), { target: { value: 'remote' } }); fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'http' } }); fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!); expect(screen.getByRole('alert')).toHaveTextContent('Please enter a URL');
    fireEvent.change(screen.getByPlaceholderText('http://localhost:3000/sse'), { target: { value: 'https://example.test/mcp' } }); fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'Authorization=Bearer token' } }); fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'oauth' } }); fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client' } }); fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!); await act(async () => undefined);
    expect(getServers()[0]).toMatchObject({ name: 'remote', config: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' } }, auth: 'oauth', oauth: { clientId: 'client' } });
  });
  it('tests OAuth and rolls back failed tool toggle saves', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } }; const { ports, mcp, getServers } = makePorts([server]); await openMcp(ports); await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate (OAuth)' })); await act(async () => undefined); expect(mcp.authenticate).toHaveBeenCalledWith(server); fireEvent.click(screen.getByRole('button', { name: 'Clear OAuth credentials' })); await act(async () => undefined); expect(mcp.logout).toHaveBeenCalledWith('remote');
    fireEvent.click(screen.getByRole('button', { name: 'Verify (show tools)' })); await act(async () => undefined); const tool = screen.getByRole('checkbox', { name: /read/i }); mcp.save.mockRejectedValueOnce(new Error('write failed')); fireEvent.click(tool); await act(async () => undefined); expect(tool).toBeChecked(); expect(getServers()[0]?.disabledTools).toBeUndefined();
  });
  it('renders verified tools as cards and supports explicit bulk enable and disable', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false };
    const { ports, getServers } = makePorts([server]);
    await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Verify (show tools)' }));
    await act(async () => undefined);

    const read = screen.getByRole('checkbox', { name: /read/i });
    const search = screen.getByRole('checkbox', { name: /search/i });
    expect(read.closest('.pivi-mcp-tool-checkbox-wrapper')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Disable all' }));
    await act(async () => undefined);
    expect(read).not.toBeChecked();
    expect(search).not.toBeChecked();
    expect(getServers()[0]?.disabledTools).toEqual(['read', 'search']);

    fireEvent.click(screen.getByRole('button', { name: 'Enable all' }));
    await act(async () => undefined);
    expect(read).toBeChecked();
    expect(search).toBeChecked();
    expect(getServers()[0]?.disabledTools).toBeUndefined();
  });
  it('locks the tool checklist while a toggle is being persisted', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false };
    const { ports, mcp } = makePorts([server]);
    let finishSave: (() => void) | undefined;
    mcp.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    await openMcp(ports);
    fireEvent.click(screen.getByRole('button', { name: 'Verify (show tools)' }));
    await act(async () => undefined);

    const read = screen.getByRole('checkbox', { name: /read/i });
    fireEvent.click(read);
    expect(read).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /search/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enable all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable all' })).toBeDisabled();

    await act(async () => { finishSave?.(); });
    expect(read).not.toBeDisabled();
  });
  it('shows alert when OAuth authenticate fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.authenticate.mockRejectedValueOnce(new Error('OAuth denied'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate (OAuth)' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('OAuth denied');
  });

  it('does not report an auth error when a public MCP needs no OAuth', async () => {
    const server: ManagedMcpServer = { name: 'deepwiki', config: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' }, enabled: true, contextSaving: true };
    const { ports, mcp } = makePorts([server]);
    mcp.authenticate.mockResolvedValueOnce('not_applicable');
    await openMcp(ports);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate (OAuth)' }));
    await act(async () => undefined);

    expect(mcp.authenticate).toHaveBeenCalledWith(server);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows authFailed fallback when OAuth authenticate fails without message', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.authenticate.mockRejectedValueOnce(new Error(''));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate (OAuth)' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('Auth failed for "remote"');
  });

  it('shows alert when OAuth logout fails', async () => {
    const server: ManagedMcpServer = { name: 'remote', config: { type: 'http', url: 'https://example.test/mcp' }, enabled: true, contextSaving: false, auth: 'oauth', oauth: { grantType: 'authorization_code' } };
    const { ports, mcp } = makePorts([server]);
    mcp.logout.mockRejectedValueOnce(new Error('logout failed'));
    await openMcp(ports);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Clear OAuth credentials' }));
    await act(async () => undefined);
    expect(screen.getByRole('alert')).toHaveTextContent('logout failed');
  });

  it('does not update after an unmounted asynchronous load resolves', async () => {
    // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+
    const { promise, resolve } = Promise.withResolvers<readonly ManagedMcpServer[]>(); const { ports } = makePorts(); ports.complex = { mcp: { ...(ports.complex.mcp), load: jest.fn(() => promise) } } as unknown as SettingsPorts['complex']; const rendered = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="mcp" /></I18nProvider>)); rendered.unmount(); await act(async () => resolve([{ name: 'late', config: { command: 'node' }, enabled: true, contextSaving: false }])); expect(screen.queryByText('late')).not.toBeInTheDocument();
  });
});
