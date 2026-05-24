import { McpServerManager } from '../../../src/core/mcp/McpServerManager';
import type { ManagedMcpServer } from '../../../src/core/types';
import { PiMcpBridge } from '../../../src/pi/mcp/PiMcpBridge';

function createStorage(servers: ManagedMcpServer[]) {
  return {
    load: jest.fn(async () => servers),
    save: jest.fn(async () => {}),
  };
}

describe('PiMcpBridge', () => {
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
    const bridge = new PiMcpBridge(manager);

    const mentions = bridge.resolveActiveMentions({
      request: {
        text: 'hello',
        enabledMcpServers: new Set(['ctx']),
      },
      persistedContent: 'hello',
      prompt: 'hello',
      isCompact: false,
      mcpMentions: new Set(),
    });

    bridge.setActiveMentions(mentions);
    const active = bridge.getActiveServers().map((server) => server.name).sort();
    expect(active).toEqual(['always', 'ctx']);
  });
});
