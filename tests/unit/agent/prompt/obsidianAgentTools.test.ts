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
    'read', 'search', 'bash', 'edit',
    'write', 'ls', 'obsidian_daily', 'pivi_sessions', 'spawn_agent',
  ];

  it.each([
    ['empty', []],
    ['read-only', ['read']],
    ['search-only', ['search']],
    ['Bash-disabled', ['read', 'search']],
    ['sessions-disabled', ['read']],
  ])('does not recommend absent tools in the complete %s prompt', (_label, names) => {
    const specs = names.filter((name) => name !== 'spawn_agent' && name !== 'pivi_sessions').map((name) => spec(name, `${name}Marker`));
    const section = build(specs, names);
    const prompt = buildSystemPrompt({}, { registeredToolNames: names, registeredToolsSection: section });

    for (const absent of sensitiveNames.filter((name) => !names.includes(name))) {
      expect(prompt).not.toContain(`\`${absent}\``);
    }
    for (const present of names) expect(prompt).toContain(`\`${present}\``);
  });

  it('uses the registered spec description and schema', () => {
    const section = build([spec('read', 'schemaMarker')]);

    expect(section).toContain('`read` — Schema-owned schemaMarker description');
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
    const edit = spec('edit', 'edit');
    edit.promptUsage = {
      summary: 'Exact local newline marker with `replaceAll: true`.',
      parameters: '`oldText` and `newText`',
    };
    const write = spec('write', 'write');
    const section = build([edit, write]);

    expect(section).toContain('including inserting line endings into a long physical line');
    expect(section).toContain('shortest unique span around the boundary—not the whole line');
    expect(section).toContain('Exact local newline marker with `replaceAll: true`.');
    expect(section).toContain('multi-thousand-character physical line never needs to be copied in full');
    expect(section).toContain('**Markdown block boundaries:** `edit` is literal');
    expect(section).toContain('See the registered `edit` descriptor for the heading/delimiter example');
    expect(section).not.toContain('replacing only `Target` with `### Heading`');
    expect(section).not.toContain('`>>` with `\\n\\n`');
    expect(section).not.toContain('sentence.Second');
  });

  it('does not describe an unregistered descriptor or a name without a descriptor', () => {
    const section = build(
      [spec('read', 'registeredMarker'), spec('search', 'unregisteredMarker')],
      ['read', 'obsidian_missing'],
    );

    expect(section).toContain('registeredMarker');
    expect(section).not.toContain('unregisteredMarker');
    expect(section).not.toContain('`obsidian_missing` —');
  });

  it('keeps unified read pagination and internal routing on `read`', () => {
    const section = build([spec('read', 'readMarker')]);

    expect(section).toContain('uses the configured Tools default read size');
    expect(section).toContain('fixed 500000-character per-read ceiling');
    expect(section).toContain('do not shrink as context pressure rises');
    expect(section).toContain('nextOffset');
    expect(section).toContain('combine 1-indexed `offset` with line-relative 1-based `startChar`');
    expect(section).toContain('exact `nextStartLine` + `nextStartChar` pair');
    expect(section).toContain('do not calculate offsets, overlap pages, or raise the budget');
    expect(section).toContain('Do not raise `maxChars` past the fixed ceiling');
    expect(section).toContain('Plan page size from `mode: "stats"`');
    expect(section).toContain('tiny `startChar` steps of around 800 characters');
    expect(section).toContain('A standalone `startChar` is file-global');
    expect(section).toContain('These coordinate systems are mutually exclusive per call');
    expect(section).toContain('do not mix a standalone file-global `startChar` with `offset`/`limit`');
    expect(section).toContain('continuation marker counts inside `maxChars`');
    expect(section).toContain('immediately retry with `maxChars` at least the required count');
    expect(section).toContain('unindexed vault files such as `.pivi/`');
    expect(section).toContain('do not retry a sibling tool');
    expect(section).not.toContain('obsidian_read_external');
    expect(section).not.toContain('startLine');
    expect(section).not.toContain('obsidian_markdown_structure');
    expect(section).not.toContain('retry with the other parameter');
  });

  it('teaches skill supporting files to use `read` / `ls` when those tools are registered', () => {
    const withRead = buildRegisteredToolsSection({
      obsidianTools: ['read', 'ls'],
      toolSpecs: [spec('read', 'readMarker'), spec('ls', 'listMarker')],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: true,
      includeSubagent: false,
      includeWebSearch: false,
    });
    expect(withRead).toContain('### Skills');
    expect(withRead).toContain('read them with `read` using the absolute paths returned by the skill tool');
    expect(withRead).toContain('List the skill directory with `ls`');
    expect(withRead).not.toContain('obsidian_read_external');

    const withoutRead = buildRegisteredToolsSection({
      obsidianTools: ['search'],
      toolSpecs: [spec('search', 'searchMarker')],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: true,
      includeSubagent: false,
      includeWebSearch: false,
    });
    expect(withoutRead).toContain('### Skills');
    expect(withoutRead).toContain('`skill` — Load a vault skill by name from .pivi/skills/');
    expect(withoutRead).not.toContain('read them with `read`');
  });

  it('routes unindexed vault files through unified `read` / `ls`', () => {
    const section = build([
      spec('read', 'readMarker'),
      spec('ls', 'listMarker'),
    ]);
    expect(section).toContain('unindexed vault files such as `.pivi/`');
    expect(section).toContain('Unindexed vault folders such as `.pivi/`');
    expect(section).toContain('do not retry a sibling tool');
    expect(section).not.toContain('obsidian_read_external');
    expect(section).not.toContain('obsidian_list_external');
    expect(section).not.toContain('retry with the other parameter');
    expect(section).toContain('Prefer `ls` for folders, including non-Markdown files');
  });
});
