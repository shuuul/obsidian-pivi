import { createHistoryTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

type CliRun = jest.Mock<Promise<string>, [{ vaultName: string; args: string[] }]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function makeDeps(): { deps: ObsidianToolDeps; cliRun: CliRun; vaultGetNote: jest.Mock } {
  const cliRun: CliRun = jest.fn(async (_request: { vaultName: string; args: string[] }) => 'cli output');
  const vaultGetNote = jest.fn();
  const deps: ObsidianToolDeps = {
    vault: {
      getNote: vaultGetNote,
    } as unknown as ObsidianToolDeps['vault'],
    cli: {
      run: cliRun,
    } as unknown as ObsidianToolDeps['cli'],
    externalFiles: {} as unknown as ObsidianToolDeps['externalFiles'],
    settings: {} as unknown as ObsidianToolDeps['settings'],
    vaultName: 'Test Vault',
  };
  return { deps, cliRun, vaultGetNote };
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

  it('restores a deleted path without prechecking the vault', async () => {
    const { deps, cliRun, vaultGetNote } = makeDeps();

    const result = await createHistoryTool(deps).execute('call-1', {
      action: 'restore',
      path: 'deleted/a.md',
      version: 3,
    });

    expect(vaultGetNote).not.toHaveBeenCalled();
    expect(cliRun).toHaveBeenCalledWith({ vaultName: 'Test Vault', args: ['history:restore', 'path=deleted/a.md', 'version=3'] });
    expect(getText(result)).toBe('Restored deleted/a.md from history version 3.');
    expect(getDetails(result)).toEqual({ action: 'restore', path: 'deleted/a.md', version: 3 });
  });

  it('rejects invalid actions and missing paths', async () => {
    const { deps } = makeDeps();
    const tool = createHistoryTool(deps);

    await expect(tool.execute('call-1', { action: 'missing' })).rejects.toThrow('Invalid history action.');
    await expect(tool.execute('call-1', { action: 'list', path: '   ' })).rejects.toThrow('path is required.');
  });
});
