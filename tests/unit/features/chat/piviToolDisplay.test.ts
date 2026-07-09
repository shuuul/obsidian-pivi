import {
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { getToolIcon, MCP_ICON_MARKER } from '@pivi/pivi-agent-core/tools/toolIcons';
import { TOOL_SKILL } from '@pivi/pivi-agent-core/tools/toolNames';
import {
  getObsidianToolDisplayName,
  getObsidianToolSummary,
  isObsidianToolCompactResult,
  parseObsidianSearchHits,
  summarizeObsidianSearchHits,
} from '@/ui/chat/rendering/piviToolDisplay';

describe('piviToolDisplay', () => {
  it('uses short chat aliases for Obsidian tools', () => {
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_GENERATE_IMAGE)).toBe('Generate image');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_MARKDOWN_STRUCTURE)).toBe('Outline');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_READ_EXTERNAL)).toBe('Read external');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_LIST_EXTERNAL)).toBe('List external');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_BASH)).toBe('Bash');
  });

  it('resolves display names for the new vault-graph, daily, tags, and base tools', () => {
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_DAILY)).toBe('Daily note');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_GRAPH)).toBe('Graph analysis');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_TAGS)).toBe('Tags');
    expect(getObsidianToolDisplayName(TOOL_OBSIDIAN_BASE)).toBe('Bases');
  });

  it('maps Obsidian tool icons by raw tool name', () => {
    expect(getToolIcon(TOOL_OBSIDIAN_EDIT)).toBe('file-pen');
    expect(getToolIcon(TOOL_OBSIDIAN_GENERATE_IMAGE)).toBe('image-plus');
    expect(getToolIcon(TOOL_OBSIDIAN_MARKDOWN_STRUCTURE)).toBe('list-tree');
    expect(getToolIcon(TOOL_OBSIDIAN_READ_EXTERNAL)).toBe('file-text');
    expect(getToolIcon(TOOL_OBSIDIAN_LIST_EXTERNAL)).toBe('list');
    expect(getToolIcon(TOOL_OBSIDIAN_BASH)).toBe('terminal');
    expect(getToolIcon(TOOL_OBSIDIAN_DAILY)).toBe('calendar');
    expect(getToolIcon(TOOL_OBSIDIAN_GRAPH)).toBe('share-2');
    expect(getToolIcon(TOOL_OBSIDIAN_TAGS)).toBe('tag');
    expect(getToolIcon(TOOL_OBSIDIAN_BASE)).toBe('database');
  });

  it('uses the shared skill icon and fallback icon contract', () => {
    expect(getToolIcon(TOOL_SKILL)).toBe('sparkles');
    expect(getToolIcon('UnknownTool')).toBe('wrench');
    expect(getToolIcon('mcp__server__tool')).toBe(MCP_ICON_MARKER);
  });

  it('summarizes search hits for header', () => {
    const hits = parseObsidianSearchHits(JSON.stringify([
      { path: 'month/2026-2.md' },
      { path: 'month/extra.md' },
    ]));
    expect(summarizeObsidianSearchHits(hits)).toBe('month/2026-2.md, month/extra.md');
  });

  it('builds search summary from input and result', () => {
    const summary = getObsidianToolSummary(
      TOOL_OBSIDIAN_SEARCH,
      { query: '*', path: 'month' },
      JSON.stringify([{ path: 'month/2026-2.md' }]),
    );
    expect(summary).toContain('*');
    expect(summary).toContain('month/2026-2.md');
  });

  it('summarizes new vault analysis tool inputs', () => {
    expect(getObsidianToolSummary(TOOL_OBSIDIAN_GRAPH, { actions: ['orphans', 'unresolved'] }))
      .toBe('orphans,unresolved');
    expect(getObsidianToolSummary(TOOL_OBSIDIAN_BASE, {
      action: 'query',
      path: 'bases/projects.base',
      view: 'Current projects',
    })).toBe('query · bases/projects.base · view: Current projects');
  });

  it('treats valid list JSON as compact even when the folder is empty', () => {
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, '[]')).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST_EXTERNAL, '[]')).toBe(true);
    expect(isObsidianToolCompactResult(
      TOOL_OBSIDIAN_LIST,
      JSON.stringify([{ path: 'writing/人的意志.md', kind: 'file' }]),
    )).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, 'not json')).toBe(false);
  });
});
