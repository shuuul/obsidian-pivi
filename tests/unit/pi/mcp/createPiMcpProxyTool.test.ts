import { createMcpProxyToolSpec } from '@pivi/pivi-agent-core/mcp/createMcpProxyToolSpec';
import type { PiMcpBridge } from '@pivi/pivi-agent-core/mcp/piMcpBridge';

function makeBridge(): PiMcpBridge {
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
  } as unknown as PiMcpBridge;
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
});