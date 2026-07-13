import { buildMcpInventoryLines } from '@pivi/pivi-agent-core/prompt/mcpInventory';
import { buildRegisteredToolsSection } from '@pivi/pivi-agent-core/prompt/obsidianAgentTools';

describe('MCP prompt inventory', () => {
  it('lists enabled servers and cached tool names without schemas', () => {
    const text = buildMcpInventoryLines([
      {
        name: 'docs',
        tools: [
          { name: 'search', description: 'Find documentation pages for a query' },
          { name: 'read' },
        ],
      },
      { name: 'cold', tools: [] },
    ]).join('\n');

    expect(text).toContain('Enabled MCP servers');
    expect(text).toContain('`docs`');
    expect(text).toContain('`search`');
    expect(text).toContain('`read`');
    expect(text).not.toContain('inputSchema');
    expect(text).toContain('`cold`');
    expect(text).toContain('tool list not cached yet');
  });

  it('injects inventory into the registered tools MCP section', () => {
    const section = buildRegisteredToolsSection({
      obsidianTools: [],
      obsidianCliAvailable: false,
      includeMcp: true,
      mcpInventory: [{ name: 'vault', tools: [{ name: 'list' }] }],
      includeSkill: false,
      includeSubagent: false,
      includeWebSearch: false,
    });

    expect(section).toContain('### MCP');
    expect(section).toContain('All settings-enabled servers are available');
    expect(section).toContain('`vault`');
    expect(section).toContain('`list`');
  });
});
