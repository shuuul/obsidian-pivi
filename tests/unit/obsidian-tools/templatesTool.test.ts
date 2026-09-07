import { createTemplatesTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      prepareActiveNoteInsertion: jest.fn().mockReturnValue({
        path: 'notes/a.md', title: 'a', insert: jest.fn().mockResolvedValue(undefined),
      }),
    },
    cli: {
      run: jest.fn().mockResolvedValue('template body'),
    },
    vaultName: 'vault',
    vaultPath: '/vault',
  } as never;
}

describe('createTemplatesTool', () => {
  it('lists templates through the official CLI', async () => {
    const deps = makeDeps();
    await createTemplatesTool(deps).execute('call', { action: 'list' });
    expect(deps.cli.run).toHaveBeenCalledWith({ vaultName: 'vault', args: ['templates'] });
  });

  it('binds the editor before resolving the template and inserts through that binding', async () => {
    const deps = makeDeps();
    const target = deps.vault.prepareActiveNoteInsertion();
    const result = await createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' });
    expect((deps.vault.prepareActiveNoteInsertion as jest.Mock).mock.invocationCallOrder[1])
      .toBeLessThan((deps.cli.run as jest.Mock).mock.invocationCallOrder[0]!);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['template:read', 'name=Travel', 'title=a', 'resolve'],
    });
    expect(target.insert).toHaveBeenCalledWith('template body');
    expect(result).toMatchObject({ details: { action: 'insert', name: 'Travel', path: 'notes/a.md' } });
  });

  it('propagates a snapshot or changed-editor failure without a mutating CLI call', async () => {
    const deps = makeDeps();
    const target = deps.vault.prepareActiveNoteInsertion();
    (target.insert as jest.Mock).mockRejectedValueOnce(new Error('snapshot failed'));

    await expect(createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' }))
      .rejects.toThrow('snapshot failed');
    expect(deps.cli.run).toHaveBeenCalledTimes(1);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault', args: ['template:read', 'name=Travel', 'title=a', 'resolve'],
    });
  });

  it('rejects insert into a Pivi-managed active file', async () => {
    const deps = makeDeps();
    (deps.vault.prepareActiveNoteInsertion as jest.Mock).mockImplementation(() => {
      throw new Error('Use pivi_commands for this path.');
    });
    await expect(createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' }))
      .rejects.toThrow(/pivi_commands/);
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
