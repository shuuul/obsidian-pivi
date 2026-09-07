import { createBookmarksTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      resolveFile: jest.fn().mockReturnValue({ path: 'notes/a.md' }),
    },
    cli: {
      run: jest.fn().mockResolvedValue('ok'),
    },
    vaultName: 'vault',
    vaultPath: '/vault',
  } as never;
}

describe('createBookmarksTool', () => {
  it('lists bookmarks as JSON by default', async () => {
    const deps = makeDeps();
    await createBookmarksTool(deps).execute('call', { action: 'list' });
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['bookmarks', 'format=json'],
    });
  });

  it('adds a resolved file bookmark', async () => {
    const deps = makeDeps();
    await createBookmarksTool(deps).execute('call', { action: 'add', file: 'Recipe' });
    expect(deps.vault.resolveFile).toHaveBeenCalledWith('Recipe', undefined);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['bookmark', 'file=notes/a.md'],
    });
  });

  it('rejects add without exactly one target', async () => {
    const deps = makeDeps();
    await expect(createBookmarksTool(deps).execute('call', { action: 'add' }))
      .rejects.toThrow('exactly one of file/path, folder, search, or url');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
