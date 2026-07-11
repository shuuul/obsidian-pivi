import { McpServerManager } from '@pivi/pivi-agent-core/mcp/mcpServerManager';
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
  it('summarizes MCP availability without connecting to servers', async () => {
    const servers: ManagedMcpServer[] = [
      {
        name: 'ctx',
        enabled: true,
        contextSaving: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'always',
        enabled: true,
        contextSaving: false,
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

  it('merges toolbar-enabled servers into active mentions', async () => {
    const servers: ManagedMcpServer[] = [
      {
        name: 'ctx',
        enabled: true,
        contextSaving: true,
        config: { command: 'echo', args: ['mcp'] },
      },
      {
        name: 'always',
        enabled: true,
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

    const mentions = bridge.resolveActiveMentions({
      request: {
        enabledMcpServers: new Set(['ctx']),
      },
      mcpMentions: new Set(),
    });

    bridge.setActiveMentions(mentions);
    const active = bridge.getActiveServers().map((server) => server.name).sort();
    expect(active).toEqual(['always', 'ctx']);
  });
});
