import { createTemplatesTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      getActiveFilePath: jest.fn().mockReturnValue('notes/a.md'),
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

  it('inserts into the active file after mutation-path checks', async () => {
    const deps = makeDeps();
    await createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' });
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['template:insert', 'name=Travel'],
    });
  });

  it('rejects insert into a Pivi-managed active file', async () => {
    const deps = makeDeps();
    (deps.vault.getActiveFilePath as jest.Mock).mockReturnValue('.pivi/commands/unsafe.md');
    await expect(createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' }))
      .rejects.toThrow(/pivi_commands/);
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
