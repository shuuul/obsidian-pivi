import {
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';

import { isObsidianToolCompactResult } from '@/ui/chat/rendering/obsidianToolResultPresentation';

describe('obsidianToolResultPresentation', () => {
  it('treats valid list JSON as compact even when the folder is empty', () => {
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, '[]')).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST_EXTERNAL, '[]')).toBe(true);
    expect(isObsidianToolCompactResult(
      TOOL_OBSIDIAN_LIST,
      JSON.stringify([{ path: 'writing/人的意志.md', kind: 'file' }]),
    )).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_LIST, 'not json')).toBe(false);
  });

  it('only compacts bounded structured search results', () => {
    expect(isObsidianToolCompactResult(
      TOOL_OBSIDIAN_SEARCH,
      JSON.stringify([{ path: 'notes/result.md', line: 4 }]),
    )).toBe(true);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_SEARCH, '[]')).toBe(false);
    expect(isObsidianToolCompactResult(TOOL_OBSIDIAN_SEARCH, 'plain text')).toBe(false);
  });
});
