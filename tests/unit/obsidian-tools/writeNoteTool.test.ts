import { createWriteNoteTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      writeNote: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
      runCliMutation: jest.fn(async (_path: string, mutate: () => Promise<unknown>) => mutate()),
    },
    cli: {
      run: jest.fn().mockResolvedValue('created'),
    },
    vaultName: 'vault',
    vaultPath: '/vault',
    obsidianCliAvailable: true,
  } as never;
}

describe('createWriteNoteTool', () => {
  it('rejects content over 50,000 characters before vault access', async () => {
    const deps = makeDeps();
    const tool = createWriteNoteTool(deps);

    await expect(tool.execute('call', {
      path: 'notes/a.md',
      content: 'x'.repeat(50_001),
    })).rejects.toThrow('content exceeds 50000 characters');
    expect(deps.vault.writeNote).not.toHaveBeenCalled();
  });

  it('passes inline prepend through the vault API', async () => {
    const deps = makeDeps();
    const tool = createWriteNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      content: 'head',
      mode: 'prepend',
      inline: true,
    });

    expect(deps.vault.writeNote).toHaveBeenCalledWith({
      file: undefined,
      path: 'notes/a.md',
      content: 'head',
      mode: 'prepend',
      overwrite: false,
      inline: true,
    });
  });

  it('creates from a template through the official CLI', async () => {
    const deps = makeDeps();
    const tool = createWriteNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/trip.md',
      mode: 'create',
      template: 'Travel',
    });

    expect(deps.vault.writeNote).not.toHaveBeenCalled();
    expect(deps.vault.runCliMutation).not.toHaveBeenCalled();
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['create', 'template=Travel', 'path=notes/trip.md'],
    });
  });

  it('binds template file input to the validated exact path', async () => {
    const deps = makeDeps();

    await createWriteNoteTool(deps).execute('call', {
      file: 'notes/trip',
      mode: 'create',
      template: 'Travel',
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['create', 'template=Travel', 'path=notes/trip.md'],
    });
  });

  it('runs template overwrite inside an exact-path CLI mutation transaction', async () => {
    const deps = makeDeps();
    const tool = createWriteNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/trip.md',
      mode: 'create',
      template: 'Travel',
      overwrite: true,
    });

    expect(deps.vault.runCliMutation).toHaveBeenCalledWith('notes/trip.md', expect.any(Function));
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['create', 'template=Travel', 'path=notes/trip.md', 'overwrite'],
    });
  });

  it('blocks template overwrite when the CLI mutation transaction fails', async () => {
    const deps = makeDeps();
    (deps.vault.runCliMutation as jest.Mock).mockRejectedValueOnce(new Error('snapshot failed'));

    await expect(createWriteNoteTool(deps).execute('call', {
      path: 'notes/trip.md',
      template: 'Travel',
      overwrite: true,
    })).rejects.toThrow('snapshot failed');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
