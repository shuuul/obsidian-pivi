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
  const testServer = jest.fn(async () => testResult);
  const host = {
    getAllViews: () => [],
  } as unknown as PiviSettingsHost;
  const workspace = {
    mcpServerTester: { testServer },
    mcpOAuth: { authenticate },
  } as unknown as PiviPluginWorkspace;

  return {
    authenticate,
    port: createMcpSettingsPort(host, workspace),
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

    await expect(harness.port.authenticate(server)).resolves.toBe('not_applicable');

    expect(harness.testServer).toHaveBeenCalledWith(server);
    expect(harness.authenticate).not.toHaveBeenCalled();
  });

  it('starts OAuth when the unauthenticated MCP probe fails', async () => {
    const harness = createHarness({ success: false, tools: [], error: 'Unauthorized' });
    const server = remoteServer('https://private.example.test/mcp');

    await expect(harness.port.authenticate(server)).resolves.toBe('authenticated');

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

    await expect(harness.port.authenticate(server)).resolves.toBe('authenticated');

    expect(harness.testServer).not.toHaveBeenCalled();
    expect(harness.authenticate).toHaveBeenCalledWith(server);
  });
});
