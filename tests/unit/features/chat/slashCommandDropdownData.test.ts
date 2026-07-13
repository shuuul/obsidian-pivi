import {
  fetchCatalogEntries,
  fetchMcpToolEntries,
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
        name: 'alpha/search',
        serverName: 'alpha',
        toolName: 'search',
      }),
    ]);
    expect(listTools).toHaveBeenCalledWith('alpha');
    expect(listTools).not.toHaveBeenCalledWith('beta');
  });
});
