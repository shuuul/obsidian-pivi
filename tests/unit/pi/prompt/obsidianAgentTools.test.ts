import {
  buildRegisteredToolsSection,
} from '@pivi/pivi-agent-core/prompt';
import {
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_SPAWN_AGENT,
} from '@pivi/pivi-agent-core/tools';

function buildSection(overrides: Partial<Parameters<typeof buildRegisteredToolsSection>[0]> = {}): string {
  return buildRegisteredToolsSection({
    obsidianTools: [],
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
    ...overrides,
  });
}

const removedGatePhrase = ['requires', 'ap' + 'proval'].join(' ');

describe('obsidian registered tool prompt section', () => {
  it('documents obsidian_history and its recovery workflow', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_HISTORY] });

    expect(section).toContain('obsidian_history');
    expect(section).toContain('Use `obsidian_history` before giving up on a deleted, overwritten, or accidentally changed vault note');
    expect(section).toContain('action: "files"');
    expect(section).toContain('action: "list"');
    expect(section).toContain('action: "read"');
    expect(section).toContain('action: "restore"');
    expect(section).toContain('History restore depends on Obsidian’s stored history');
  });

  it('does not describe command or eval as gated', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_COMMAND, TOOL_OBSIDIAN_EVAL] });

    expect(section).toContain('obsidian_command');
    expect(section).toContain('obsidian_eval');
    expect(section).not.toContain(removedGatePhrase);
  });

  it('does not describe delete move or mkdir as gated', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_DELETE, TOOL_OBSIDIAN_MOVE, TOOL_OBSIDIAN_MKDIR],
    });

    expect(section).toContain('obsidian_delete');
    expect(section).toContain('obsidian_move');
    expect(section).toContain('obsidian_mkdir');
    expect(section).not.toContain(removedGatePhrase);
  });

  it('documents that obsidian_search is case-insensitive', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_SEARCH] });

    expect(section).toContain('Case-insensitive substring search');
    expect(section).toContain('Do not repeat the same search with different casing');
  });

  it('documents the safe large Markdown read workflow', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE] });

    expect(section).toContain('mode: "stats"');
    expect(section).toContain('obsidian_markdown_structure');
    expect(section).toContain('startLine');
    expect(section).toContain('endLine');
  });

  it('does not instruct models to use disabled read or markdown structure tools', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_SEARCH] });

    expect(section).toContain('No direct note-read tool is registered');
    expect(section).not.toContain('obsidian_read');
    expect(section).not.toContain('obsidian_markdown_structure');
    expect(section).not.toContain('mode: "stats"');
  });

  it('does not recommend subagent delegation when spawn_agent is not registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE],
      includeSubagent: false,
    });

    expect(section).not.toContain(TOOL_SPAWN_AGENT);
    expect(section).not.toContain('Automatic delegation for complex multi-context tasks');
    expect(section).not.toContain('Sub-agent delegation overrides direct reading');
  });

  it('includes subagent reading guidance only when spawn_agent is registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE],
      includeSubagent: true,
    });

    expect(section).toContain(TOOL_SPAWN_AGENT);
    expect(section).toContain('Automatic delegation for complex multi-context tasks');
    expect(section).toContain('Sub-agent delegation overrides direct reading');
    expect(section).toContain('When a very long file must be read end-to-end');
    expect(section).toContain('prefer `spawn_agent` with `run_in_background: true` and that single file as the delegated context batch');
    expect(section).toContain('Let the worker continue interacting with vault/tools in the background');
  });

  it('omits markdown structure guidance when only obsidian_read is registered', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_READ] });

    expect(section).toContain('obsidian_read');
    expect(section).toContain('mode: "stats"');
    expect(section).toContain('line range');
    expect(section).toContain('obsidian_markdown_structure` is not registered');
    expect(section).not.toContain('prefer `obsidian_markdown_structure`');
  });

  it('emits a Web section with WebSearch and WebFetch only when includeWebSearch is true', () => {
    const withoutSection = buildSection({ includeWebSearch: false });
    expect(withoutSection).not.toContain('### Web');
    expect(withoutSection).not.toContain('WebSearch');
    expect(withoutSection).not.toContain('WebFetch');

    const withSection = buildSection({ includeWebSearch: true });
    expect(withSection).toContain('### Web');
    expect(withSection).toContain('`WebSearch`');
    expect(withSection).toContain('Search the web for up-to-date information');
    expect(withSection).toContain('`WebFetch`');
    expect(withSection).toContain('Fetch readable content from a specific HTTP(S) URL');
    expect(withSection).toContain('Use `WebFetch` when you already have a URL');
  });

  it('documents external read tools only when they are registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ_EXTERNAL, TOOL_OBSIDIAN_LIST_EXTERNAL],
    });

    expect(section).toContain(TOOL_OBSIDIAN_READ_EXTERNAL);
    expect(section).toContain('obsidian_list_external');
    expect(section).toContain('Read external files by absolute path');
    expect(section).toContain('use `obsidian_read_external` with an absolute path under an allowed external directory');
  });

  it('omits external read tools when they are not registered', () => {
    const section = buildSection({ obsidianTools: [] });

    expect(section).not.toContain(TOOL_OBSIDIAN_READ_EXTERNAL);
    expect(section).not.toContain('obsidian_list_external');
  });
});
