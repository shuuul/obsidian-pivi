import { createWriteNoteTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      writeNote: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
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
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['create', 'template=Travel', 'path=notes/trip.md'],
    });
  });
});
