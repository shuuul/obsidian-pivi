import {
  buildItemList,
  fetchCatalogEntries,
  fetchMcpToolEntries,
  mergeMcpEntries,
} from '@/ui/shared/components/slashCommandDropdownData';

describe('slashCommandDropdownData prefetch helpers', () => {
  it('treats an empty catalog as fetched so first open does not re-read', async () => {
    const getCatalogEntries = jest.fn(async () => []);
    const result = await fetchCatalogEntries(false, getCatalogEntries, 1, 1);
    expect(result).toEqual({ kind: 'ok', entries: [] });
    expect(getCatalogEntries).toHaveBeenCalledTimes(1);

    const noop = await fetchCatalogEntries(true, getCatalogEntries, 2, 2);
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
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: false },
        ],
      }),
      () => ({ listTools }),
      1,
      1,
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
      1,
      1,
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
      1,
      1,
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
      content: '',
      displayPrefix: '/',
      insertPrefix: '/',
      serverName,
      toolName: 'search',
    });

    const entries = buildItemList(null, [tool('alpha'), tool('beta'), tool('alpha')], [], new Set(), true);

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
      true,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.identity).toBe('/review');
  });

  it('merges partial retries by stable identity without duplicating cached entries', () => {
    const entry = (identity: string, description: string) => ({
      kind: 'mcp' as const,
      identity,
      displayName: 'search',
      insertValue: 'alpha/search',
      description,
      content: '',
      displayPrefix: '/',
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
