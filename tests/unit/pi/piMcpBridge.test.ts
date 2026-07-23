import { McpServerManager } from '@pivi/pivi-agent-core/mcp/mcpServerManager';
import { PiMcpConnectionPool } from '@pivi/pivi-agent-core/mcp/piMcpConnectionPool';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';
import { PiMcpBridge } from '@pivi/pivi-agent-core/mcp/piMcpBridge';
import type { McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';


function createStorage(servers: ManagedMcpServer[]) {
  return {
    load: jest.fn(async () => servers),
    save: jest.fn(async () => {}),
  };
}



describe('PiMcpBridge', () => {
  it('disposes its private connection pool', async () => {
    const manager = new McpServerManager(createStorage([]));
    const dispose = jest.spyOn(PiMcpConnectionPool.prototype, 'dispose');
    const bridge = new PiMcpBridge(manager, null, jest.fn(), {});

    await bridge.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    dispose.mockRestore();
  });

  it('summarizes MCP availability without connecting to servers', async () => {
    const servers: ManagedMcpServer[] = [
      {
        name: 'ctx',
        enabled: true,
        contextSaving: true,
        stdioActivationConfirmed: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'always',
        enabled: true,
        contextSaving: false,
        stdioActivationConfirmed: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'disabled',
        enabled: false,
        contextSaving: false,
        config: { command: 'echo', args: ['mcp'] },
      },
    ];
    const manager = new McpServerManager(createStorage(servers));
    await manager.loadServers();

    expect(manager.getAvailabilitySummary()).toEqual({
      totalCount: 3,
      enabledCount: 2,
      alwaysActiveCount: 1,
      contextSavingCount: 1,
    });
  });

  it('prefetches enabled remote servers but leaves stdio lazy', async () => {
    const servers: ManagedMcpServer[] = [
      {
        name: 'remote',
        enabled: true,
        contextSaving: true,
        config: { type: 'http', url: 'https://remote.example.com/mcp' },
      },
      {
        name: 'local',
        enabled: true,
        contextSaving: true,
        stdioActivationConfirmed: true,
        config: { type: 'stdio', command: 'node', args: ['server.js'] },
      },
    ];
    const manager = new McpServerManager(createStorage(servers));
    await manager.loadServers();
    const listTools = jest
      .spyOn(PiMcpConnectionPool.prototype, 'listTools')
      .mockResolvedValue([]);
    const bridge = new PiMcpBridge(manager, null, jest.fn(), {});

    await bridge.prefetchEnabledTools();

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({ name: 'remote' }));

    await bridge.listCachedTools('local');
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({ name: 'local' }));
    listTools.mockRestore();
  });

  it('treats all settings-enabled servers as active without toolbar selection', async () => {
    const servers: ManagedMcpServer[] = [
      {
        name: 'ctx',
        enabled: true,
        contextSaving: true,
        stdioActivationConfirmed: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'always',
        enabled: true,
        contextSaving: false,
        stdioActivationConfirmed: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'disabled',
        enabled: false,
        contextSaving: false,
        config: { command: 'echo', args: ['mcp'] },
      },
    ];
    const manager = new McpServerManager(createStorage(servers));
    await manager.loadServers();
    const bridge = new PiMcpBridge(
      manager,
      null,
      jest.fn(),
      {},
    );

    bridge.setActiveMentions(new Set());
    const active = bridge.getActiveServers().map((server) => server.name).sort();
    expect(active).toEqual(['always', 'ctx']);
    expect(Object.keys(manager.getActiveServers(new Set())).sort()).toEqual(['always', 'ctx']);
  });
});
