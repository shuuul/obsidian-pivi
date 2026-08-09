import { buildRegisteredToolsSection } from '@pivi/agent/prompt';
import { buildSystemPrompt } from '@pivi/agent/prompt';
import type { ToolSpec } from '@pivi/agent/tools';

function spec(name: string, marker: string, required = true): ToolSpec {
  return {
    name,
    description: `Schema-owned ${marker} description`,
    parameters: {
      type: 'object',
      properties: { [marker]: { type: 'string' } },
      ...(required ? { required: [marker] } : {}),
    },
    async execute() {},
  };
}

function build(toolSpecs: ToolSpec[], names = toolSpecs.map((tool) => tool.name)): string {
  return buildRegisteredToolsSection({
    obsidianTools: names,
    toolSpecs,
    obsidianCliAvailable: true,
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
  });
}

describe('registered tool prompt descriptors', () => {
  const sensitiveNames = [
    'obsidian_read', 'obsidian_search', 'obsidian_bash', 'obsidian_edit',
    'obsidian_write', 'obsidian_list', 'pivi_sessions', 'spawn_agent',
  ];

  it.each([
    ['empty', []],
    ['read-only', ['obsidian_read']],
    ['search-only', ['obsidian_search']],
    ['Bash-disabled', ['obsidian_read', 'obsidian_search']],
    ['sessions-disabled', ['obsidian_read']],
  ])('does not recommend absent tools in the complete %s prompt', (_label, names) => {
    const specs = names.filter((name) => name.startsWith('obsidian_')).map((name) => spec(name, `${name}Marker`));
    const section = build(specs, names);
    const prompt = buildSystemPrompt({}, { registeredToolNames: names, registeredToolsSection: section });

    for (const absent of sensitiveNames.filter((name) => !names.includes(name))) {
      expect(prompt).not.toContain(absent);
    }
    for (const present of names) expect(prompt).toContain(present);
  });

  it('uses the registered spec description and schema', () => {
    const section = build([spec('obsidian_read', 'schemaMarker')]);

    expect(section).toContain('`obsidian_read` — Schema-owned schemaMarker description');
    expect(section).toContain('Parameters: `schemaMarker`');
  });

  it('uses a factory-owned usage override when present', () => {
    const guided = spec('pivi_commands', 'schemaMarker');
    guided.promptUsage = {
      summary: 'Factory-owned behavior marker',
      parameters: '`catalogRevision` required for mutations',
    };

    const section = build([guided]);

    expect(section).toContain('Factory-owned behavior marker');
    expect(section).toContain('`catalogRevision` required for mutations');
    expect(section).not.toContain('Schema-owned schemaMarker');
  });

  it('does not describe an unregistered descriptor or a name without a descriptor', () => {
    const section = build(
      [spec('obsidian_read', 'registeredMarker'), spec('obsidian_search', 'unregisteredMarker')],
      ['obsidian_read', 'obsidian_missing'],
    );

    expect(section).toContain('registeredMarker');
    expect(section).not.toContain('unregisteredMarker');
    expect(section).not.toContain('`obsidian_missing` —');
  });

  it('keeps read pagination guidance when external read is not registered', () => {
    const section = build([spec('obsidian_read', 'readMarker')]);

    expect(section).toContain('Each of `obsidian_read` clamps `maxChars`');
    expect(section).toContain('nextStartLine');
    expect(section).not.toContain('obsidian_read_external');
    expect(section).not.toContain('obsidian_markdown_structure');
  });

  it('keeps external path guidance when vault read is not registered', () => {
    const section = build([spec('obsidian_read_external', 'externalMarker')]);

    expect(section).toContain('use `obsidian_read_external` with an absolute path');
    expect(section).not.toContain('obsidian_read` for absolute paths');
  });
});
