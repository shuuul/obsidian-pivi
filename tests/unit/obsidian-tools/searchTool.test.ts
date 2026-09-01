import { createSearchTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(cliEnabled = true): ObsidianToolDeps {
  return {
    vault: {
      searchNotes: jest.fn().mockResolvedValue([]),
    },
    settings: { cliEnabled },
  } as never;
}

describe('createSearchTool promptUsage', () => {
  it('owns search-not-read guidance on the tool descriptor', () => {
    const tool = createSearchTool(makeDeps());

    expect(tool.promptUsage?.summary).toContain('never as a content-read backdoor');
    expect(tool.promptUsage?.summary).toContain('`context: true` dumps are not a substitute for reading note bodies');
    expect(tool.promptUsage?.summary).not.toContain('obsidian_read');
  });
});
