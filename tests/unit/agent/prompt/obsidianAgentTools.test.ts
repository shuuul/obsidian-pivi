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
    'obsidian_write', 'obsidian_list', 'obsidian_daily', 'pivi_sessions', 'spawn_agent',
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

  it('teaches local-substring newline insertion through the registered exact replacement tool', () => {
    const edit = spec('obsidian_edit', 'edit');
    edit.promptUsage = {
      summary: 'Exact local newline marker with `replace_all: true`.',
      parameters: '`old_string` and `new_string`',
    };
    const write = spec('obsidian_write', 'write');
    const section = build([edit, write]);

    expect(section).toContain('including inserting line endings into a long physical line');
    expect(section).toContain('shortest unique span around the boundary—not the whole line');
    expect(section).toContain('Exact local newline marker with `replace_all: true`.');
    expect(section).toContain('multi-thousand-character physical line never needs to be copied in full');
    expect(section).toContain('**Markdown block boundaries:** `obsidian_edit` is literal');
    expect(section).toContain('See the registered `obsidian_edit` descriptor for the heading/delimiter example');
    expect(section).not.toContain('replacing only `Target` with `### Heading`');
    expect(section).not.toContain('`>>` with `\\n\\n`');
    expect(section).not.toContain('sentence.Second');
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

    expect(section).toContain('uses the configured Tools default read size');
    expect(section).toContain('fixed 500000-character per-read ceiling');
    expect(section).toContain('do not shrink as context pressure rises');
    expect(section).toContain('nextStartLine');
    expect(section).toContain('combine 1-based `startLine` with line-relative 1-based `startChar`');
    expect(section).toContain('exact `nextStartLine` + `nextStartChar` pair');
    expect(section).toContain('do not calculate offsets, overlap pages, or raise the budget');
    expect(section).toContain('Do not raise `maxChars` past the fixed ceiling');
    expect(section).toContain('Plan page size from `mode: "stats"`');
    expect(section).toContain('tiny `startChar` steps of around 800 characters');
    expect(section).toContain('A standalone `startChar` is file-global');
    expect(section).toContain('These coordinate systems are mutually exclusive per call');
    expect(section).toContain('do not mix a standalone file-global `startChar` with `startLine`/`endLine`');
    expect(section).toContain('do not combine it with `endLine` unless `startLine` is also present');
    expect(section).toContain('continuation marker counts inside `maxChars`');
    expect(section).not.toContain('immediately retry with `maxChars` at least the required count');
    expect(section).not.toContain('obsidian_read_external');
    expect(section).not.toContain('obsidian_markdown_structure');
  });

  it('keeps external path guidance when vault read is not registered', () => {
    const section = build([spec('obsidian_read_external', 'externalMarker')]);

    expect(section).toContain('use `obsidian_read_external` with an absolute path');
    expect(section).toContain('immediately retry with `maxChars` at least the required count');
    expect(section).not.toContain('nextStartChar');
    expect(section).not.toContain('obsidian_read` for absolute paths');
  });

  it('reminds skill supporting files to use obsidian_read_external only when that tool is registered', () => {
    const withExternal = buildRegisteredToolsSection({
      obsidianTools: ['obsidian_read_external'],
      toolSpecs: [spec('obsidian_read_external', 'externalMarker')],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: true,
      includeSubagent: false,
      includeWebSearch: false,
    });
    expect(withExternal).toContain('### Skills');
    expect(withExternal).toContain('read them with `obsidian_read_external` using the absolute skill directory');

    const withoutExternal = buildRegisteredToolsSection({
      obsidianTools: ['obsidian_read'],
      toolSpecs: [spec('obsidian_read', 'readMarker')],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: true,
      includeSubagent: false,
      includeWebSearch: false,
    });
    expect(withoutExternal).toContain('### Skills');
    expect(withoutExternal).toContain('`skill` — Load a vault skill by name from .pivi/skills/');
    expect(withoutExternal).not.toContain('obsidian_read_external');
  });

  it('routes unindexed vault files to external tools only when those tools are registered', () => {
    const withExternal = build([
      spec('obsidian_read', 'readMarker'),
      spec('obsidian_list', 'listMarker'),
      spec('obsidian_read_external', 'readExternalMarker'),
      spec('obsidian_list_external', 'listExternalMarker'),
    ]);
    expect(withExternal).toContain('Retry with `obsidian_read_external` using the absolute path');
    expect(withExternal).toContain('If `obsidian_list` returns "Vault path not found"');
    expect(withExternal).toContain('retry with `obsidian_list_external` and the absolute path');
    expect(withExternal).toContain('files Obsidian does not index (including `.pivi/`)');

    const withoutExternal = build([spec('obsidian_read', 'readMarker'), spec('obsidian_list', 'listMarker')]);
    expect(withoutExternal).toContain('If `obsidian_read` returns "Note not found", retry with the other parameter');
    expect(withoutExternal).not.toContain('obsidian_read_external');
    expect(withoutExternal).not.toContain('obsidian_list_external');
    expect(withoutExternal).toContain('Prefer `obsidian_list` when you need non-Markdown files or folders');
  });
});
