import { createCommandTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(commandAllowlist: string[] = [], allowCommand = false): ObsidianToolDeps {
  return {
    cli: { run: jest.fn().mockResolvedValue('ok') },
    settings: { commandAllowlist, allowCommand },
    vaultName: 'vault',
  } as never;
}

describe('createCommandTool', () => {
  it('preserves id-only execution and enforces the execution allowlist', async () => {
    const deps = makeDeps(['workspace:split'], true);
    const tool = createCommandTool(deps);

    await tool.execute('call', { id: 'workspace:split' });
    await expect(tool.execute('call', { action: 'execute', id: 'unsafe' }))
      .rejects.toThrow('not explicitly allowed');

    expect(deps.cli.run).toHaveBeenCalledTimes(1);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['command', 'id=workspace:split'],
    });
  });

  it('denies execution when disabled or when the allowlist is empty', async () => {
    await expect(createCommandTool(makeDeps(['workspace:split'])).execute('call', { id: 'workspace:split' }))
      .rejects.toThrow('Command execution is disabled');
    await expect(createCommandTool(makeDeps([], true)).execute('call', { id: 'workspace:split' }))
      .rejects.toThrow('not explicitly allowed');
  });

  it('discovers command ids with an optional prefix filter', async () => {
    const deps = makeDeps();

    await createCommandTool(deps).execute('call', { action: 'list', filter: 'editor:' });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['commands', 'filter=editor:'],
    });
  });

  it('reads one hotkey without applying the execution allowlist', async () => {
    const deps = makeDeps(['allowed-only']);

    await createCommandTool(deps).execute('call', {
      action: 'hotkey',
      id: 'editor:toggle-bold',
      verbose: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['hotkey', 'id=editor:toggle-bold', 'verbose'],
    });
  });

  it('lists hotkeys as agent-friendly JSON with supported flags', async () => {
    const deps = makeDeps();

    await createCommandTool(deps).execute('call', {
      action: 'hotkeys',
      verbose: true,
      total: true,
      all: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['hotkeys', 'format=json', 'verbose', 'total', 'all'],
    });
  });

  it('requires id only for execute and hotkey actions', async () => {
    const deps = makeDeps();
    const tool = createCommandTool(deps);

    await expect(tool.execute('call', { action: 'execute' })).rejects.toThrow('id is required for execute');
    await expect(tool.execute('call', { action: 'hotkey' })).rejects.toThrow('id is required for hotkey');
    await expect(tool.execute('call', { action: 'remove' })).rejects.toThrow('Invalid command action');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
