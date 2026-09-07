import { createSearchTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(cliEnabled = true): ObsidianToolDeps {
  return {
    vault: {
      searchNotes: jest.fn().mockResolvedValue([]),
      resolveFile: jest.fn().mockReturnValue(null),
    },
    settings: { cliEnabled },
  } as never;
}

describe('createSearchTool promptUsage', () => {
  it('owns search-not-read guidance on the tool descriptor', () => {
    const tool = createSearchTool(makeDeps());

    expect(tool.promptUsage?.summary).toContain('never as a content-read backdoor');
    expect(tool.promptUsage?.summary).toContain('`context: true` dumps are not a substitute for reading note bodies');
    expect(tool.promptUsage?.summary).toContain('`path` is required: one Markdown note or a non-root folder');
    expect(tool.promptUsage?.parameters).toContain('required Markdown note or non-root folder');
    expect(tool.promptUsage?.summary).not.toContain('obsidian_read');
    expect(tool.promptUsage?.summary).not.toContain('omit `path`');
    expect(tool.parameters.required).toEqual(['query', 'path']);
  });

  it('rejects listing queries toward ls', async () => {
    const deps = makeDeps();
    const tool = createSearchTool(deps);

    await expect(tool.execute('call', { query: '*' })).rejects.toThrow('Use `ls` with `path` instead');
    await expect(tool.execute('call', { query: '**' })).rejects.toThrow('Use `ls` with `path` instead');
    await expect(tool.execute('call', { query: 'path:notes' })).rejects.toThrow('Use `ls` with `path` instead');
    expect(deps.vault.searchNotes).not.toHaveBeenCalled();
  });

  it('rejects missing, empty, slash, and vault-root paths before searchNotes', async () => {
    const deps = makeDeps();
    const tool = createSearchTool(deps);

    await expect(tool.execute('call', { query: 'hello' })).rejects.toThrow('non-root folder');
    await expect(tool.execute('call', { query: 'hello', path: '' })).rejects.toThrow('non-root folder');
    await expect(tool.execute('call', { query: 'hello', path: '   ' })).rejects.toThrow('non-root folder');
    await expect(tool.execute('call', { query: 'hello', path: '/' })).rejects.toThrow('non-root folder');
    await expect(tool.execute('call', { query: 'hello', path: '.' })).rejects.toThrow('non-root folder');
    expect(deps.vault.searchNotes).not.toHaveBeenCalled();
  });

  it('caps a scoped context:true payload and keeps a continuation marker', async () => {
    const hits = Array.from({ length: 80 }, (_, index) => ({
      path: `sources/transcripts/note-${index}.md`,
      line: 1,
      matches: [
        'aaaa'.repeat(80),
        'bbbb'.repeat(80),
        'cccc'.repeat(80),
        'dddd'.repeat(80),
        'eeee'.repeat(80),
      ],
    }));
    const deps = makeDeps();
    (deps.vault.searchNotes as jest.Mock).mockResolvedValue(hits);
    const tool = createSearchTool(deps);

    const result = await tool.execute('call', {
      query: 'hello',
      path: 'sources/transcripts',
      context: true,
    }) as {
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    };
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const page = JSON.parse(text) as {
      hits: unknown[];
      offset: number;
      nextOffset?: number;
    };

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(page.hits.length).toBeGreaterThan(0);
    expect(page.hits.length).toBeLessThan(80);
    expect(page.nextOffset).toBe(page.hits.length);
    expect(result.details).toMatchObject({
      returnedCount: page.hits.length,
      nextOffset: page.nextOffset,
    });
    expect((page.hits[0] as { matches: string[] }).matches.every((line) => line.length <= 201)).toBe(true);
    expect(deps.vault.searchNotes).toHaveBeenCalledWith({
      query: 'hello',
      path: 'sources/transcripts',
      limit: 50,
      offset: 0,
      context: true,
      caseSensitive: false,
    });
  });

  it('passes case sensitivity through API and CLI fallback', async () => {
    const deps = makeDeps();
    const tool = createSearchTool(deps);

    await tool.execute('call', {
      query: 'Hello',
      path: 'notes',
      caseSensitive: true,
    });
    expect(deps.vault.searchNotes).toHaveBeenCalledWith(expect.objectContaining({ caseSensitive: true }));

    (deps.vault.searchNotes as jest.Mock).mockRejectedValueOnce(new Error('api failed'));
    Object.assign(deps, { cli: { run: jest.fn().mockResolvedValue('[]') } });
    await createSearchTool(deps).execute('call', {
      query: 'Hello',
      path: 'notes',
      caseSensitive: true,
    });
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: undefined,
      args: ['search', 'query="Hello"', 'path="notes"', 'format=json', 'limit=50', 'case'],
    });
  });

  it('rejects a CLI fallback that cannot honor a nonzero offset', async () => {
    const deps = makeDeps();
    (deps.vault.searchNotes as jest.Mock).mockRejectedValue(new Error('api failed'));
    Object.assign(deps, { cli: { run: jest.fn() } });

    await expect(createSearchTool(deps).execute('call', {
      query: 'hello',
      path: 'notes',
      offset: 25,
    })).rejects.toThrow('cannot honor offset=25');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects a CLI fallback that cannot constrain search to one note', async () => {
    const deps = makeDeps();
    (deps.vault.searchNotes as jest.Mock).mockRejectedValue(new Error('api failed'));
    (deps.vault.resolveFile as jest.Mock).mockReturnValue({ path: 'notes/a.md' });
    Object.assign(deps, { cli: { run: jest.fn() } });

    await expect(createSearchTool(deps).execute('call', {
      query: 'hello',
      path: 'notes/a.md',
    })).rejects.toThrow('cannot constrain search to the note notes/a.md');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('caps CLI fallback stdout', async () => {
    const deps = makeDeps();
    (deps.vault.searchNotes as jest.Mock).mockRejectedValue(new Error('api failed'));
    Object.assign(deps, {
      cli: { run: jest.fn().mockResolvedValue('x'.repeat(80_000)) },
    });
    const tool = createSearchTool(deps);

    const result = await tool.execute('call', {
      query: 'hello',
      path: 'sources/transcripts',
    }) as { content: Array<{ type: string; text: string }> };
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toContain('[cli output truncated to 50000 characters]');
  });

  it('rejects an oversize limit before searchNotes', async () => {
    const deps = makeDeps();
    const tool = createSearchTool(deps);

    await expect(tool.execute('call', {
      query: 'hello',
      path: 'notes',
      limit: 201,
    })).rejects.toThrow('limit must be an integer from 1 to 200');
    expect(deps.vault.searchNotes).not.toHaveBeenCalled();
  });
});
