import { createTemplatesTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      getActiveFilePath: jest.fn().mockReturnValue('notes/a.md'),
      captureSnapshotBeforeCliMutation: jest.fn().mockResolvedValue(undefined),
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

  it('snapshots the active file before inserting a template', async () => {
    const deps = makeDeps();
    await createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' });
    expect(deps.vault.captureSnapshotBeforeCliMutation).toHaveBeenCalledWith('notes/a.md');
    expect((deps.vault.captureSnapshotBeforeCliMutation as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((deps.cli.run as jest.Mock).mock.invocationCallOrder[0]!);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['template:insert', 'name=Travel'],
    });
  });

  it('does not invoke the CLI when the pre-insert snapshot fails', async () => {
    const deps = makeDeps();
    (deps.vault.captureSnapshotBeforeCliMutation as jest.Mock).mockRejectedValueOnce(new Error('snapshot failed'));

    await expect(createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' }))
      .rejects.toThrow('snapshot failed');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects insert into a Pivi-managed active file', async () => {
    const deps = makeDeps();
    (deps.vault.getActiveFilePath as jest.Mock).mockReturnValue('.pivi/commands/unsafe.md');
    await expect(createTemplatesTool(deps).execute('call', { action: 'insert', name: 'Travel' }))
      .rejects.toThrow(/pivi_commands/);
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
