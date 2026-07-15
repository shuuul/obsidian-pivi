import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

import type { PiviPluginWorkspace, PiviSettingsHost } from '@/app/hostContracts';
import { createMcpSettingsPort } from '@/app/ui/createMcpSettingsPorts';

const DEEPWIKI_MCP_URL = 'https://mcp.deepwiki.com/mcp';

function remoteServer(url = DEEPWIKI_MCP_URL): ManagedMcpServer {
  return {
    name: 'deepwiki',
    config: { type: 'http', url },
    enabled: true,
    contextSaving: true,
  };
}

function createHarness(testResult: { success: boolean; tools: Array<{ name: string }>; error?: string }) {
  const authenticate = jest.fn(async () => 'authenticated' as const);
  const getAuthStatus = jest.fn(async () => 'not_authenticated' as const);
  const testServer = jest.fn(async () => testResult);
  const testConnection = jest.fn(async () => testResult);
  const getCachedTools = jest.fn(() => [{ name: 'cached_tool' }]);
  const cacheTools = jest.fn();
  const server = remoteServer();
  const host = {
    getAllViews: () => [],
  } as unknown as PiviSettingsHost;
  const workspace = {
    mcpServerTester: { testServer },
    mcpDiagnostics: { testConnection },
    mcpToolProvider: { getCachedTools, cacheTools },
    mcpOAuth: { authenticate, getAuthStatus },
  } as unknown as PiviPluginWorkspace;

  return {
    authenticate,
    cacheTools,
    getCachedTools,
    getAuthStatus,
    port: createMcpSettingsPort(host, workspace),
    server,
    testConnection,
    testServer,
  };
}

describe('createMcpSettingsPort authentication', () => {
  it('treats the public DeepWiki MCP endpoint as not requiring OAuth', async () => {
    const harness = createHarness({
      success: true,
      tools: [
        { name: 'read_wiki_structure' },
        { name: 'ask_question' },
      ],
    });
    const server = remoteServer();

    await expect(harness.port.connect(server)).resolves.toMatchObject({
      authStatus: 'not_applicable',
      result: { success: true },
    });

    expect(harness.testServer).toHaveBeenCalledWith(server);
    expect(harness.authenticate).not.toHaveBeenCalled();
  });

  it('starts OAuth when the unauthenticated MCP probe fails', async () => {
    const harness = createHarness({ success: false, tools: [], error: 'Unauthorized' });
    const server = remoteServer('https://private.example.test/mcp');

    await expect(harness.port.connect(server)).resolves.toMatchObject({
      authStatus: 'authenticated',
    });

    expect(harness.testServer).toHaveBeenCalledWith(server);
    expect(harness.authenticate).toHaveBeenCalledWith(server);
  });

  it('does not probe when OAuth was explicitly configured', async () => {
    const harness = createHarness({ success: true, tools: [{ name: 'public_tool' }] });
    const server: ManagedMcpServer = {
      ...remoteServer(),
      auth: 'oauth',
      oauth: { clientId: 'configured-client' },
    };

    await expect(harness.port.connect(server)).resolves.toMatchObject({
      authStatus: 'authenticated',
    });

    expect(harness.testServer).not.toHaveBeenCalled();
    expect(harness.authenticate).toHaveBeenCalledWith(server);
  });
});

describe('createMcpSettingsPort tool inventory', () => {
  it('reads the shared cache without opening a connection', async () => {
    const harness = createHarness({ success: true, tools: [{ name: 'ask_question' }] });

    await expect(harness.port.listTools('deepwiki')).resolves.toEqual([{ name: 'cached_tool' }]);

    expect(harness.getCachedTools).toHaveBeenCalledWith('deepwiki');
    expect(harness.testConnection).not.toHaveBeenCalled();
  });

  it('uses the authenticated diagnostics connection and caches refreshed tools', async () => {
    const harness = createHarness({ success: true, tools: [{ name: 'ask_question' }] });

    await expect(harness.port.connect(harness.server)).resolves.toEqual({
      authStatus: 'not_applicable',
      result: { success: true, tools: [{ name: 'ask_question' }] },
    });

    expect(harness.testConnection).toHaveBeenCalledWith(harness.server);
    expect(harness.cacheTools).toHaveBeenCalledWith('deepwiki', [{ name: 'ask_question' }]);
    expect(harness.testServer).toHaveBeenCalledWith(harness.server);
  });

  it('keeps the previous cache when refresh fails', async () => {
    const harness = createHarness({ success: false, tools: [], error: 'Unauthorized' });

    await expect(harness.port.connect(harness.server)).resolves.toMatchObject({
      result: { success: false },
    });

    expect(harness.cacheTools).not.toHaveBeenCalled();
  });
});
