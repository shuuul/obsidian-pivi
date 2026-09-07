import {
  createLinksTool,
  createNoteInfoTool,
  type ObsidianToolDeps,
} from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      getLinks: jest.fn(() => { throw new Error('api failed'); }),
      getNoteInfo: jest.fn(async () => { throw new Error('api failed'); }),
    },
    cli: { run: jest.fn().mockResolvedValue('ok') },
    settings: { cliEnabled: true },
    obsidianCliAvailable: true,
    vaultName: 'vault',
  } as never;
}

describe('Obsidian CLI fallback contracts', () => {
  it('does not pass backlinks-only format to outgoing links', async () => {
    const deps = makeDeps();

    await createLinksTool(deps).execute('call', {
      path: 'notes/a.md',
      direction: 'outgoing',
      total: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['links', 'total', 'path="notes/a.md"'],
    });
  });

  it('passes supported backlinks count and output options', async () => {
    const deps = makeDeps();

    await createLinksTool(deps).execute('call', {
      file: 'Recipe',
      direction: 'backlinks',
      format: 'csv',
      counts: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['backlinks', 'format=csv', 'counts', 'file=Recipe'],
    });
  });

  it('does not pass unsupported format to the file command', async () => {
    const deps = makeDeps();

    await createNoteInfoTool(deps).execute('call', { path: 'notes/a.md' });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['file', 'path="notes/a.md"'],
    });
  });
});
