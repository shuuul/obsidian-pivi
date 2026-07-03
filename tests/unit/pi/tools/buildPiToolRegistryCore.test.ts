import type { PiSubagentQueryRunner } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import type { PiMcpBridge } from '@pivi/pivi-agent-core/mcp';
import type { RegisteredToolSummary } from '@pivi/pivi-agent-core/prompt';
import { TOOL_SKILL, TOOL_SUBAGENT, type ToolSpec } from '@pivi/pivi-agent-core/tools';
import { buildPiToolRegistryCore } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
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

function createFakeMcpBridge(toolSpecs: ToolSpec[]): PiMcpBridge {
  return {
    getToolSpecs: () => toolSpecs,
  } as PiMcpBridge;
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
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    allowCommand: false,
    allowEval: false,
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
      TOOL_SUBAGENT,
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
    expect(registry.registeredToolsSection).toContain('### Subagents');
    expect(registry.registeredToolsSection).toContain(`\`${TOOL_SUBAGENT}\``);
    expect(registry.registeredToolsSection).toContain('### MCP');
    expect(registry.registeredToolsSection).toContain('`mcp`');
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

    const agentTool = registry.tools.find((tool) => tool.name === TOOL_SUBAGENT);
    expect(agentTool).toBeDefined();

    const result = await agentTool!.execute('agent-call', {
      description: 'Registry probe',
      prompt: '  run subtask  ',
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
});