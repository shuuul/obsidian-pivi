import {
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { getToolIcon } from '@pivi/pivi-agent-core/tools/toolIcons';
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
  });

  it('maps Obsidian tool icons by raw tool name', () => {
    expect(getToolIcon(TOOL_OBSIDIAN_EDIT)).toBe('file-pen');
    expect(getToolIcon(TOOL_OBSIDIAN_GENERATE_IMAGE)).toBe('image-plus');
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

  it('treats valid list JSON as compact even when the folder is empty', () => {
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, '[]')).toBe(true);
    expect(isObsidianToolCompactResult(
      TOOL_OBSIDIAN_LIST,
      JSON.stringify([{ path: 'writing/人的意志.md', kind: 'file' }]),
    )).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, 'not json')).toBe(false);
  });
});
