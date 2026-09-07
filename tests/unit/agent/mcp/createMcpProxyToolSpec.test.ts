import { createMcpProxyToolSpec } from '@pivi/agent/mcp/createMcpProxyToolSpec';
import type { McpToolBridge } from '@pivi/agent/mcp/mcpToolBridge';

function makeBridge(): McpToolBridge {
  return {
    listCachedTools: jest.fn().mockResolvedValue([
      {
        name: 'lookup',
        description: 'Lookup things',
        inputSchema: {
          properties: {
            query: { description: { text: 'bad' } },
            limit: { description: 'Max results' },
          },
        },
      },
    ]),
    getActiveServers: jest.fn().mockReturnValue([]),
    searchTools: jest.fn().mockReturnValue([]),
    getServerSummaries: jest.fn().mockReturnValue([]),
  } as unknown as McpToolBridge;
}

describe('createMcpProxyToolSpec', () => {
  it('does not stringify object-valued schema descriptions', async () => {
    const tool = createMcpProxyToolSpec(makeBridge());

    const result = await tool.execute('call', { server: 'vault' });
    if (!result || typeof result !== 'object' || !('content' in result)) {
      throw new Error('expected tool result with content');
    }
    const content = result.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error('expected non-empty content array');
    }
    const first = content[0];
    if (!first || typeof first !== 'object' || !('type' in first) || first.type !== 'text') {
      throw new Error('expected text content block');
    }
    const text = 'text' in first && typeof first.text === 'string' ? first.text : '';

    expect(text).toContain('- query');
    expect(text).toContain('- limit: Max results');
    expect(text).not.toContain('[object Object]');
  });

  it('caps MCP call results before they become model-visible text', async () => {
    const bridge = makeBridge();
    (bridge as unknown as { callTool: jest.Mock }).callTool = jest.fn().mockResolvedValue('x'.repeat(80_000));
    const tool = createMcpProxyToolSpec(bridge);

    const result = await tool.execute('call', {
      server: 'vault',
      tool: 'lookup',
      args: '{}',
    }) as { content: Array<{ type: string; text: string }> };
    const text = result.content[0]?.text ?? '';

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toContain('[mcp call truncated to 50000 characters]');
  });
});
