import { createWriteNoteTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      writeNote: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
    },
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
});
