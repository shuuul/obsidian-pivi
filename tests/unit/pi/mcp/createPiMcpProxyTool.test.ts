import { createPiMcpProxyTool } from '../../../../src/pi/mcp/createPiMcpProxyTool';
import type { PiMcpBridge } from '../../../../src/pi/mcp/PiMcpBridge';

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

describe('createPiMcpProxyTool', () => {
  it('does not stringify object-valued schema descriptions', async () => {
    const tool = createPiMcpProxyTool(makeBridge());

    const result = await tool.execute('call', { server: 'vault' });
    const [content] = result.content;
    expect(content.type).toBe('text');
    const text = content.type === 'text' ? content.text : '';

    expect(text).toContain('- query');
    expect(text).toContain('- limit: Max results');
    expect(text).not.toContain('[object Object]');
  });
});
