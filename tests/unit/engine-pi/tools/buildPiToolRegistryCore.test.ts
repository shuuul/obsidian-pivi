import type { PiSubagentQueryRunner } from '@pivi/engine-pi/createSubagentTool';
import type { McpToolBridge } from '@pivi/agent/mcp';
import type { RegisteredToolSummary } from '@pivi/agent/prompt';
import {
  TOOL_PIVI_SESSIONS,
  TOOL_SKILL,
  TOOL_SPAWN_AGENT,
  type ToolSpec,
} from '@pivi/agent/tools';
import { buildPiToolRegistryCore } from '@pivi/engine-pi/buildPiToolRegistryCore';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function createBaseToolSpec(name = 'fixture_base'): ToolSpec {
  return {
    name,
    description: 'Base fixture tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return { content: [{ type: 'text', text: 'base-ok' }], details: {} };
    },
  };
}

function createGuidedToolSpec(name: string, marker: string): ToolSpec {
  return {
    ...createBaseToolSpec(name),
    promptUsage: {
      summary: `Factory-owned ${marker} summary`,
      parameters: `\`${marker}\` required`,
    },
  };
}

function createMcpToolSpec(): ToolSpec {
  return {
    name: 'mcp',
    label: 'MCP',
    description: 'MCP proxy fixture',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return { content: [{ type: 'text', text: 'mcp-ok' }], details: {} };
    },
  };
}

function createFakeMcpBridge(toolSpecs: ToolSpec[]): McpToolBridge {
  return {
    getToolSpecs: () => toolSpecs,
    getCachedInventory: () => [],
  } as unknown as McpToolBridge;
}

function seedVaultContext(vaultPath: string): void {
  fs.mkdirSync(path.join(vaultPath, '.pivi', 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Always cite sources.', 'utf-8');
  fs.writeFileSync(path.join(vaultPath, '.pivi', 'SYSTEM.md'), 'Vault-wide system rules.', 'utf-8');
  fs.writeFileSync(
    path.join(vaultPath, '.pivi', 'skills', 'demo-skill', 'SKILL.md'),
    `---
name: demo-skill
description: Demo skill for registry
---
# Skill body`,
    'utf-8',
  );
}

describe('buildPiToolRegistryCore', () => {
  let vaultPath: string;

  const registeredToolSummary: RegisteredToolSummary = {
    obsidianTools: ['obsidian_read'],
    obsidianCliAvailable: true,
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
  };

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-registry-core-'));
    seedVaultContext(vaultPath);
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('assembles base tools, skill, subagent, and MCP tools in registry output', () => {
    const baseName = 'fixture_base';
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: createFakeMcpBridge([createMcpToolSpec()]),
      baseToolSpecs: [createBaseToolSpec(baseName)],
      registeredToolSummary,
    });

    expect(registry.tools.map((tool) => tool.name)).toEqual([
      baseName,
      TOOL_SKILL,
      TOOL_SPAWN_AGENT,
      'mcp',
    ]);
  });

  it('includes Skill, Subagent, and MCP blocks in registeredToolsSection when MCP tools are present', () => {
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: createFakeMcpBridge([createMcpToolSpec()]),
      baseToolSpecs: [createBaseToolSpec()],
      registeredToolSummary,
    });

    expect(registry.registeredToolsSection).toContain('### Skills');
    expect(registry.registeredToolsSection).toContain(`\`${TOOL_SKILL}\``);
    expect(registry.registeredToolNames).toEqual(registry.tools.map((tool) => tool.name));
    expect(registry.registeredToolNames).toContain(TOOL_SKILL);
    expect(registry.registeredToolNames).toContain(TOOL_SPAWN_AGENT);
    expect(registry.registeredToolsSection).toContain('### Subagents');
    expect(registry.registeredToolsSection).toContain(`\`${TOOL_SPAWN_AGENT}\``);
    expect(registry.registeredToolsSection).toContain('Automatically use multiple sub-agents');
    expect(registry.registeredToolsSection).toContain('assign a stable, non-overlapping context batch');
    expect(registry.registeredToolsSection).toContain('keeps delegated context out of the main session');
    expect(registry.registeredToolsSection).toContain('Automatic delegation for complex multi-context tasks');
    expect(registry.registeredToolsSection).toContain('### MCP');
    expect(registry.registeredToolsSection).toContain('`mcp`');
  });

  it('publishes the configured plugin-wide subagent limit in the tool and system prompt', () => {
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [],
      registeredToolSummary,
      subagentSettings: {
        allowBackground: true,
        enabled: true,
        maxConcurrentSubagents: 2,
      },
    });
    const spawnTool = registry.tools.find((tool) => tool.name === TOOL_SPAWN_AGENT);

    expect(spawnTool?.description).toContain('At most 2 background sub-agents');
    expect(spawnTool?.description).toContain('same assistant response');
    expect(spawnTool?.executionMode).toBe('parallel');
    expect(registry.registeredToolsSection).toContain('At most 2 background sub-agents');
    expect(registry.registeredToolsSection).toContain('shared across all tabs');
    expect(registry.registeredToolsSection).toContain('same assistant response');
    expect(registry.registeredToolsSection).toContain('create 2 balanced non-overlapping batches');
    expect(registry.registeredToolsSection).toContain('Do not spawn only one worker and wait');
    expect(registry.registeredToolsSection).toContain('FIFO');
  });

  it('omits the MCP block from registeredToolsSection when mcpBridge is null', () => {
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [createBaseToolSpec()],
      registeredToolSummary,
    });

    expect(registry.registeredToolsSection).toContain('### Skills');
    expect(registry.registeredToolsSection).toContain('### Subagents');
    expect(registry.registeredToolsSection).not.toContain('### MCP');
  });

  it('appends AGENTS, vault system, and skills context from loadContextLayers', () => {
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [],
      registeredToolSummary,
    });

    expect(registry.contextAppendices).toHaveLength(3);
    expect(registry.contextAppendices[0]).toContain('## Project instructions (AGENTS.md)');
    expect(registry.contextAppendices[0]).toContain('Always cite sources.');
    expect(registry.contextAppendices[1]).toContain('## Vault system');
    expect(registry.contextAppendices[1]).toContain('Vault-wide system rules.');
    expect(registry.contextAppendices[2]).toContain('<available_skills>');
    expect(registry.contextAppendices[2]).toContain('name="demo-skill"');
  });

  it('routes Agent tool execution through the injected subagentQueryRunner', async () => {
    const query = jest.fn(
      async (_options: { systemPrompt: string }, prompt: string) => `done:${prompt}`,
    );
    const runner: PiSubagentQueryRunner = { query };

    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: runner,
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [],
      registeredToolSummary,
    });

    const agentTool = registry.tools.find((tool) => tool.name === TOOL_SPAWN_AGENT);
    expect(agentTool).toBeDefined();

    const result = await agentTool!.execute('agent-call', {
      label: 'Registry probe',
      message: '  run subtask  ',
      run_in_background: false,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Task: Registry probe'),
      }),
      'run subtask',
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'done:run subtask' }],
      details: {},
    });
  });

  it('includes main-only ToolSpecs in the main registry after base tools', () => {
    const mainOnly = createBaseToolSpec('fixture_main_only');
    mainOnly.executionMode = 'sequential';
    mainOnly.description = 'Main-only fixture for prompt listing';

    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: createFakeMcpBridge([createMcpToolSpec()]),
      baseToolSpecs: [createBaseToolSpec('fixture_base')],
      mainOnlyToolSpecs: [mainOnly],
      registeredToolSummary,
    });

    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'fixture_base',
      'fixture_main_only',
      TOOL_SKILL,
      TOOL_SPAWN_AGENT,
      'mcp',
    ]);
  });

  it('appends main-only tool names into registeredToolsSection prompt guidance', () => {
    const mainOnly = createBaseToolSpec('fixture_main_only');

    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [createBaseToolSpec('fixture_base')],
      mainOnlyToolSpecs: [mainOnly],
      registeredToolSummary: {
        ...registeredToolSummary,
        obsidianTools: ['obsidian_read'],
      },
    });

    expect(registry.registeredToolsSection).toContain('`obsidian_read`');
    expect(registry.registeredToolsSection).toContain('`fixture_main_only`');
  });

  it('builds detailed guidance from actual registered ToolSpecs only', () => {
    const registered = createGuidedToolSpec('obsidian_read', 'factoryMarker');
    const unregistered = createGuidedToolSpec('obsidian_search', 'missingMarker');

    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [registered],
      registeredToolSummary: {
        ...registeredToolSummary,
        obsidianTools: [registered.name],
        toolSpecs: [unregistered],
      },
    });

    expect(registry.registeredToolsSection).toContain('Factory-owned factoryMarker summary');
    expect(registry.registeredToolsSection).toContain('`factoryMarker` required');
    expect(registry.registeredToolsSection).not.toContain('missingMarker');
    expect(registry.registeredToolsSection).not.toContain('`obsidian_search` —');
  });

  it.each([true, false])(
    'keeps main/subagent session inventories and prompt guidance aligned when enabled=%s',
    (enabled) => {
      const sessionSpec = createGuidedToolSpec(TOOL_PIVI_SESSIONS, 'sessionFile');
      const baseToolSpecs = enabled ? [sessionSpec] : [];
      const buildInventory = () => buildPiToolRegistryCore({
        subagentQueryRunner: { query: async () => 'unused' },
        vaultPath,
        mcpBridge: null,
        baseToolSpecs,
        registeredToolSummary: {
          ...registeredToolSummary,
          obsidianTools: baseToolSpecs.map(spec => spec.name),
        },
      });
      const main = buildInventory();
      const subagent = buildInventory();

      for (const inventory of [main, subagent]) {
        expect(inventory.tools.filter(tool => tool.name === TOOL_PIVI_SESSIONS))
          .toHaveLength(enabled ? 1 : 0);
        expect(inventory.registeredToolsSection.includes('Factory-owned sessionFile summary'))
          .toBe(enabled);
        expect(inventory.registeredToolsSection.includes('`sessionFile` required'))
          .toBe(enabled);
      }
    },
  );

  it('preserves sequential executionMode through the Pi adapter for main-only tools', () => {
    const mainOnly = createBaseToolSpec('fixture_main_only');
    mainOnly.executionMode = 'sequential';

    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [],
      mainOnlyToolSpecs: [mainOnly],
      registeredToolSummary,
    });

    const tool = registry.tools.find((entry) => entry.name === 'fixture_main_only');
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('sequential');
  });

  it('omits main-only tools when mainOnlyToolSpecs is absent', () => {
    const registry = buildPiToolRegistryCore({
      subagentQueryRunner: { query: async () => 'unused' },
      vaultPath,
      mcpBridge: null,
      baseToolSpecs: [createBaseToolSpec('fixture_base')],
      registeredToolSummary,
    });

    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'fixture_base',
      TOOL_SKILL,
      TOOL_SPAWN_AGENT,
    ]);
    expect(registry.registeredToolsSection).not.toContain('fixture_main_only');
  });
});
