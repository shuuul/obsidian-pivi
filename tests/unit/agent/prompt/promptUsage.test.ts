import {
  buildMcpInventoryLines,
  buildRegisteredToolsSection,
  composePromptSections,
  estimatePromptUsageSections,
} from '@pivi/agent/prompt';
import { OBSIDIAN_AGENT_TOOLS, type ToolSpec } from '@pivi/agent/tools';

const REPRESENTATIVE_MCP_INVENTORY = [
  {
    name: 'docs',
    tools: [
      { name: 'search', description: 'Find documentation pages for a query' },
      { name: 'read' },
    ],
  },
] as const;

function spec(name: string): Pick<ToolSpec, 'name' | 'description' | 'parameters' | 'promptUsage'> {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  };
}

function representativeToolsSection(includeMcp: boolean): string {
  return buildRegisteredToolsSection({
    obsidianTools: [...OBSIDIAN_AGENT_TOOLS],
    toolSpecs: OBSIDIAN_AGENT_TOOLS.map((name) => spec(name)),
    obsidianCliAvailable: true,
    includeMcp,
    mcpInventory: includeMcp ? [...REPRESENTATIVE_MCP_INVENTORY] : [],
    includeSkill: true,
    includeSubagent: true,
    maxConcurrentSubagents: 3,
    includeWebSearch: true,
  });
}

function representativeMcpSection(): string {
  return [
    '### MCP',
    '- `mcp` — Vault MCP servers (.pivi/mcp.json). All settings-enabled servers are available; use search/list before calling tools.',
    ...buildMcpInventoryLines([...REPRESENTATIVE_MCP_INVENTORY]),
  ].join('\n');
}

describe('prompt usage estimation', () => {
  it('estimates each usage section independently', () => {
    const composed = composePromptSections();
    const tools = representativeToolsSection(false);
    const mcp = representativeMcpSection();
    const estimates = estimatePromptUsageSections({
      core: composed.core,
      workflow: composed.workflow,
      custom: composed.custom,
      tools,
      mcp,
    });

    expect(estimates.map((section) => section.id)).toEqual([
      'core',
      'workflow',
      'custom',
      'tools',
      'mcp',
    ]);
    for (const section of estimates) {
      expect(section.estimatedTokens).toBeGreaterThanOrEqual(0);
    }
    expect(estimates.find((section) => section.id === 'workflow')?.estimatedTokens).toBeGreaterThan(0);
    expect(estimates.find((section) => section.id === 'custom')?.estimatedTokens).toBe(0);
  });
});

describe('default-enabled shipped composition', () => {
  it('returns positive core and workflow estimates', () => {
    const composed = composePromptSections();
    const estimates = estimatePromptUsageSections({
      core: composed.core,
      workflow: composed.workflow,
      custom: '',
      tools: representativeToolsSection(false),
      mcp: representativeMcpSection(),
    });
    const core = estimates.find((section) => section.id === 'core');
    const workflow = estimates.find((section) => section.id === 'workflow');

    expect(core?.estimatedTokens).toBeGreaterThan(0);
    expect(workflow?.estimatedTokens).toBeGreaterThan(0);
  });
});
