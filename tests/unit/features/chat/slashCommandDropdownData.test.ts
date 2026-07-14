import {
  buildItemList,
  fetchCatalogEntries,
  fetchMcpToolEntries,
  mergeMcpEntries,
} from '@/ui/shared/components/slashCommandDropdownData';

describe('slashCommandDropdownData prefetch helpers', () => {
  it('treats an empty catalog as fetched so first open does not re-read', async () => {
    const getCatalogEntries = jest.fn(async () => []);
    const result = await fetchCatalogEntries(false, getCatalogEntries);
    expect(result).toEqual({ kind: 'ok', entries: [] });
    expect(getCatalogEntries).toHaveBeenCalledTimes(1);

    const noop = await fetchCatalogEntries(true, getCatalogEntries);
    expect(noop).toEqual({ kind: 'noop' });
    expect(getCatalogEntries).toHaveBeenCalledTimes(1);
  });

  it('builds MCP slash entries from enabled servers and marks them fetched', async () => {
    const listTools = jest.fn(async (serverName: string) => {
      if (serverName === 'alpha') {
        return [{ name: 'search', description: 'Search docs' }];
      }
      return [];
    });
    const result = await fetchMcpToolEntries(
      false,
      () => ({
        getServers: () => [
          { name: 'alpha', enabled: true, description: 'Primary knowledge server' },
          { name: 'beta', enabled: false },
        ],
      }),
      () => ({ listTools }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.fetched).toBe(true);
    expect(result.entries).toEqual([
      expect.objectContaining({
        kind: 'mcp',
        identity: '/alpha',
        displayName: 'alpha',
        insertValue: 'alpha',
        description: 'Primary knowledge server',
        serverName: 'alpha',
      }),
      expect.objectContaining({
        kind: 'mcp',
        identity: '/alpha/search',
        displayName: 'search',
        insertValue: 'alpha/search',
        serverName: 'alpha',
        toolName: 'search',
      }),
    ]);
    expect(listTools).toHaveBeenCalledWith('alpha');
    expect(listTools).not.toHaveBeenCalledWith('beta');
  });

  it('lists tool names when an MCP server has no configured description', async () => {
    const result = await fetchMcpToolEntries(
      false,
      () => ({ getServers: () => [{ name: 'alpha', enabled: true, description: '  ' }] }),
      () => ({
        listTools: async () => [
          { name: 'search', description: 'Search docs' },
          { name: 'fetch', description: 'Fetch a page' },
          { name: 'search', description: 'Duplicate result' },
        ],
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.entries.find((entry) => entry.identity === '/alpha')).toMatchObject({
      description: 'search · fetch',
    });
  });

  it('keeps successful server entries and remains retryable after a partial failure', async () => {
    const listTools = jest.fn(async (serverName: string) => {
      if (serverName === 'offline') throw new Error('unavailable');
      return [{ name: 'search' }];
    });
    const result = await fetchMcpToolEntries(
      false,
      () => ({
        getServers: () => [
          { name: 'online', enabled: true },
          { name: 'offline', enabled: true },
        ],
      }),
      () => ({ listTools }),
    );

    expect(result).toMatchObject({ kind: 'ok', fetched: false });
    if (result.kind !== 'ok') return;
    expect(result.entries.map((entry) => entry.identity)).toEqual([
      '/online',
      '/offline',
      '/online/search',
    ]);
    expect(listTools).toHaveBeenCalledWith('online');
    expect(listTools).toHaveBeenCalledWith('offline');
  });

  it('offers server-only entries when tool discovery is unavailable', async () => {
    const result = await fetchMcpToolEntries(
      false,
      () => ({ getServers: () => [{ name: 'alpha', enabled: true }] }),
      () => null,
    );

    expect(result).toMatchObject({
      kind: 'ok',
      fetched: true,
      entries: [expect.objectContaining({ displayName: 'alpha', insertValue: 'alpha' })],
    });
  });

  it('deduplicates by identity while retaining equal short tool names from different servers', () => {
    const tool = (serverName: string) => ({
      kind: 'mcp' as const,
      identity: `/${serverName}/search`,
      displayName: 'search',
      insertValue: `${serverName}/search`,
      insertPrefix: '/',
      serverName,
      toolName: 'search',
    });

    const entries = buildItemList(null, [tool('alpha'), tool('beta'), tool('alpha')], [], new Set());

    expect(entries.map((entry) => entry.insertValue)).toEqual(['alpha/search', 'beta/search']);
  });

  it('deduplicates entries that insert the same canonical token across sources', () => {
    const entries = buildItemList(
      () => [{ name: 'review' }],
      [],
      [{
        id: 'workspace-review',
        kind: 'skill',
        name: 'review',
        content: '',
        scope: 'workspace',
        source: 'user',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      }],
      new Set(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.identity).toBe('/review');
  });

  it('keeps slash insertion separate from skill and command labels', () => {
    const entries = buildItemList(
      () => [{ name: 'review' }],
      [],
      [{
        id: 'compact',
        kind: 'command',
        name: 'compact',
        content: '/compact',
        scope: 'builtin',
        source: 'builtin',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      }],
      new Set(),
    );

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'skill', displayName: 'review', insertPrefix: '/' }),
      expect.objectContaining({ kind: 'command', displayName: 'compact', insertPrefix: '/' }),
    ]));
  });

  it('builds tool entries without command callbacks while preserving slash insertion', () => {
    const entries = buildItemList(
      null,
      [],
      [{
        id: 'generate-image',
        kind: 'tool',
        name: 'generate-image',
        description: 'Generate an image',
        content: '',
        toolName: 'obsidian_generate_image',
        scope: 'builtin',
        source: 'builtin',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      }],
      new Set(),
    );

    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'tool',
        displayName: 'generate-image',
        insertPrefix: '/',
        toolName: 'obsidian_generate_image',
      }),
    ]);
    expect(entries[0]?.slashCommand).toBeUndefined();
  });

  it('merges partial retries by stable identity without duplicating cached entries', () => {
    const entry = (identity: string, description: string) => ({
      kind: 'mcp' as const,
      identity,
      displayName: 'search',
      insertValue: 'alpha/search',
      description,
      insertPrefix: '/',
    });

    expect(mergeMcpEntries(
      [entry('/alpha/search', 'old')],
      [entry('/alpha/search', 'new'), entry('/beta/search', 'beta')],
    )).toEqual([
      entry('/alpha/search', 'new'),
      entry('/beta/search', 'beta'),
    ]);
  });
});
