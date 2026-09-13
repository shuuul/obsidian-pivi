import { createHistoryTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

type CliRun = jest.Mock<Promise<string>, [{ vaultName: string; args: string[] }]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function makeDeps(): {
  deps: ObsidianToolDeps;
  cliRun: CliRun;
  runCliMutation: jest.Mock;
} {
  const cliRun: CliRun = jest.fn(async (_request: { vaultName: string; args: string[] }) => 'cli output');
  const runCliMutation = jest.fn(async (_path: string, mutate: () => Promise<unknown>) => mutate());
  const deps: ObsidianToolDeps = {
    app: { vault: { adapter: { basePath: '/vault' } } } as unknown as ObsidianToolDeps['app'],
    vault: {
      runCliMutation,
      resolveFile: jest.fn(() => null),
    } as unknown as ObsidianToolDeps['vault'],
    cli: {
      run: cliRun,
    } as unknown as ObsidianToolDeps['cli'],
    externalFiles: {} as unknown as ObsidianToolDeps['externalFiles'],
    settings: {} as unknown as ObsidianToolDeps['settings'],
    vaultName: 'Test Vault',
    vaultPath: '/vault',
    processRunner: { run: jest.fn() },
  };
  return { deps, cliRun, runCliMutation };
}

function getText(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('missing result content');
  }
  const { content } = result;
  if (!Array.isArray(content)) {
    throw new Error('result content is not an array');
  }
  const first = content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('missing text content');
  }
  return first.text;
}

function getDetails(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object' || !('details' in result)) {
    throw new Error('missing result details');
  }
  const { details } = result;
  if (!isRecord(details)) {
    throw new Error('result details is not an object');
  }
  return details;
}

describe('createHistoryTool', () => {
  it('lists history-enabled files', async () => {
    const { deps, cliRun } = makeDeps();
    cliRun.mockResolvedValueOnce('notes/a.md\nnotes/b.md');

    const result = await createHistoryTool(deps).execute('call-1', { action: 'files' });

    expect(cliRun).toHaveBeenCalledWith({ vaultName: 'Test Vault', args: ['history:list'] });
    expect(getText(result)).toBe('notes/a.md\nnotes/b.md');
    expect(getDetails(result)).toEqual({ action: 'files' });
  });

  it('lists versions for a known path', async () => {
    const { deps, cliRun } = makeDeps();

    const result = await createHistoryTool(deps).execute('call-1', {
      action: 'list',
      path: 'notes/a.md',
    });

    expect(cliRun).toHaveBeenCalledWith({ vaultName: 'Test Vault', args: ['history', 'path=notes/a.md'] });
    expect(getText(result)).toBe('cli output');
    expect(getDetails(result)).toEqual({ action: 'list', path: 'notes/a.md' });
  });

  it('rejects read without an integer version', async () => {
    const { deps } = makeDeps();
    const tool = createHistoryTool(deps);

    await expect(tool.execute('call-1', { action: 'read', path: 'notes/a.md' }))
      .rejects.toThrow('version is required for read and restore.');
    await expect(tool.execute('call-1', { action: 'read', path: 'notes/a.md', version: 1.5 }))
      .rejects.toThrow('version is required for read and restore.');
  });

  it('reads a specific version', async () => {
    const { deps, cliRun } = makeDeps();

    const result = await createHistoryTool(deps).execute('call-1', {
      action: 'read',
      path: 'notes/a.md',
      version: 2,
    });

    expect(cliRun).toHaveBeenCalledWith({ vaultName: 'Test Vault', args: ['history:read', 'path=notes/a.md', 'version=2'] });
    expect(getText(result)).toBe('cli output');
    expect(getDetails(result)).toEqual({ action: 'read', path: 'notes/a.md', version: 2 });
  });

  it('restores a deleted path without requiring the file to exist', async () => {
    const { deps, cliRun, runCliMutation } = makeDeps();
    // File Recovery retains versions after deletion, and a deleted destination
    // has no current state to snapshot, so nothing shifts the numbering.
    cliRun.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === 'history') {
        return [
          'deleted/a.md',
          '1\t2026-09-13 14:01\t9.58 KB',
          '2\t2026-09-13 13:56\t9.58 KB',
        ].join('\n');
      }
      return 'restored output';
    });

    const result = await createHistoryTool(deps).execute('call-1', {
      action: 'restore',
      path: 'deleted/a.md',
      version: 2,
    });

    expect(runCliMutation).toHaveBeenCalledWith('deleted/a.md', expect.any(Function));
    expect(cliRun).toHaveBeenCalledWith({ vaultName: 'Test Vault', args: ['history:restore', 'path=deleted/a.md', 'version=2'] });
    expect(getText(result)).toBe('Restored deleted/a.md from history version 2.');
    expect(getDetails(result)).toEqual({
      action: 'restore',
      path: 'deleted/a.md',
      version: 2,
      resolvedVersion: 2,
      output: 'restored output',
    });
  });

  it('blocks restore before the CLI when the current snapshot fails', async () => {
    const { deps, cliRun, runCliMutation } = makeDeps();
    cliRun.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === 'history') {
        return ['notes/a.md', '1\t2026-09-13 14:01\t9.58 KB'].join('\n');
      }
      return 'cli output';
    });
    runCliMutation.mockRejectedValueOnce(new Error('snapshot failed'));

    await expect(createHistoryTool(deps).execute('call-1', {
      action: 'restore',
      path: 'notes/a.md',
      version: 1,
    })).rejects.toThrow('snapshot failed');

    // The read-only anchor list may run first, but the mutating restore
    // command must never reach the CLI once the snapshot has failed.
    expect(cliRun.mock.calls.map((call) => call[0].args[0])).not.toContain('history:restore');
  });

  it('rejects restoring Pivi-managed paths before invoking the CLI', async () => {
    const { deps, cliRun } = makeDeps();

    await expect(createHistoryTool(deps).execute('call-1', {
      action: 'restore',
      path: '.pivi/mcp.json',
      version: 1,
    })).rejects.toThrow(/pivi_mcp/);

    expect(cliRun).not.toHaveBeenCalled();
  });

  it('rejects invalid actions and missing paths', async () => {
    const { deps } = makeDeps();
    const tool = createHistoryTool(deps);

    await expect(tool.execute('call-1', { action: 'missing' })).rejects.toThrow('Invalid history action.');
    await expect(tool.execute('call-1', { action: 'list', path: '   ' })).rejects.toThrow('file or path is required.');
  });

  it('diffs versions for a known path', async () => {
    const { deps, cliRun } = makeDeps();

    const result = await createHistoryTool(deps).execute('call-1', {
      action: 'diff',
      path: 'notes/a.md',
      from: 2,
      to: 1,
      filter: 'local',
    });

    expect(cliRun).toHaveBeenCalledWith({
      vaultName: 'Test Vault',
      args: ['diff', 'path=notes/a.md', 'from=2', 'to=1', 'filter=local'],
    });
    expect(getText(result)).toBe('cli output');
    expect(getDetails(result)).toEqual({
      action: 'diff',
      path: 'notes/a.md',
      from: 2,
      to: 1,
      filter: 'local',
    });
  });

  it('lists versions with file= instead of path=', async () => {
    const { deps, cliRun } = makeDeps();

    await createHistoryTool(deps).execute('call-1', {
      action: 'list',
      file: 'Recipe',
    });

    expect(cliRun).toHaveBeenCalledWith({
      vaultName: 'Test Vault',
      args: ['history', 'file=Recipe'],
    });
  });
});
