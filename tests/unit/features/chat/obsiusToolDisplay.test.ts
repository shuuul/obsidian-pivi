import { TOOL_OBSIDIAN_SEARCH } from '../../../../src/core/tools/obsidianToolNames';
import {
  getObsidianToolSummary,
  parseObsidianSearchHits,
  summarizeObsidianSearchHits,
} from '../../../../src/features/chat/rendering/obsiusToolDisplay';

describe('obsiusToolDisplay', () => {
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
});
