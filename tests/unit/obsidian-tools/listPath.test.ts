import { createListPathTool } from '@pivi/obsidian-tools';

function entry(index: number) {
  return {
    path: `sources/transcripts/note-${index}.md`,
    kind: 'file',
    name: `note-${index}.md`,
    extension: 'md',
    size: index,
  };
}

describe('obsidian_list pagination', () => {
  it('returns a bounded first page and an exact continuation offset', async () => {
    const entries = Array.from({ length: 1_250 }, (_, index) => entry(index));
    const tool = createListPathTool({
      vault: { listPath: jest.fn().mockReturnValue(entries) },
    } as never);

    const result = await tool.execute('call-1', { path: 'sources/transcripts' }) as {
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    };
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const page = JSON.parse(text);

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(page).toMatchObject({
      offset: 0,
      nextOffset: 100,
      total: 1_250,
    });
    expect(page.entries).toHaveLength(100);
    expect(result.details).toMatchObject({
      count: 1_250,
      returnedCount: 100,
      nextOffset: 100,
    });
  });

  it('continues from nextOffset without repeating entries', async () => {
    const entries = Array.from({ length: 205 }, (_, index) => entry(index));
    const tool = createListPathTool({
      vault: { listPath: jest.fn().mockReturnValue(entries) },
    } as never);

    const result = await tool.execute('call-2', { offset: 200, limit: 100 }) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const page = JSON.parse(text);

    expect(page.entries.map((item: { name: string }) => item.name)).toEqual([
      'note-200.md',
      'note-201.md',
      'note-202.md',
      'note-203.md',
      'note-204.md',
    ]);
    expect(page).not.toHaveProperty('nextOffset');
  });

  it('rejects invalid pagination instead of silently widening output', async () => {
    const tool = createListPathTool({
      vault: { listPath: jest.fn().mockReturnValue([]) },
    } as never);

    await expect(tool.execute('call-3', { limit: 201 })).rejects.toThrow(
      'limit must be an integer from 1 to 200',
    );
  });
});
