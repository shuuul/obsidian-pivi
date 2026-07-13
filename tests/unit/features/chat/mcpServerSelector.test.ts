import { McpServerManager } from '@pivi/pivi-agent-core/mcp/mcpServerManager';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';

import { McpServerSelector } from '@/ui/chat/toolbar/McpControl';

async function createManager(servers: ManagedMcpServer[]): Promise<McpServerManager> {
  const manager = new McpServerManager({ load: jest.fn(async () => servers) });
  await manager.loadServers();
  return manager;
}

describe('McpServerSelector runtime model', () => {
  it('publishes recovery capabilities and delegates recovery actions without DOM ownership', async () => {
    const server: ManagedMcpServer = { name: 'remote', enabled: true, contextSaving: true, config: { type: 'http', url: 'https://mcp.example.com' }, auth: 'oauth' };
    const selector = new McpServerSelector();
    const authenticate = jest.fn().mockResolvedValue('authenticated');
    const testServer = jest.fn().mockResolvedValue({ toolCount: 2 });
    const openSettings = jest.fn();
    selector.setMcpManager(await createManager([server]));
    selector.setRecoveryActions({ mcpOAuth: { authenticate }, mcpProbeProvider: { testServer }, openSettings });

    expect(selector.getSnapshot().servers).toEqual([expect.objectContaining({ name: 'remote', canAuthenticate: true, canTest: true, canOpenSettings: true })]);
    await expect(selector.authenticate('remote')).resolves.toBe('authenticated');
    await expect(selector.testServer('remote')).resolves.toEqual({ toolCount: 2 });
    selector.openSettings();
    expect(authenticate).toHaveBeenCalledWith(server);
    expect(testServer).toHaveBeenCalledWith('remote');
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('filters disabled servers at read time without losing the selection', async () => {
    const server: ManagedMcpServer = { name: 'remote', enabled: true, contextSaving: true, config: { type: 'http', url: 'https://mcp.example.com' } };
    const selector = new McpServerSelector();
    selector.setMcpManager(await createManager([server]));
    selector.setEnabledServers(['remote']);
    server.enabled = false;
    expect(selector.getEnabledServers()).toEqual(new Set());
    server.enabled = true;
    expect(selector.getEnabledServers()).toEqual(new Set(['remote']));
  });
});
