import { createAttachmentTool } from '../../../../src/pi/tools/obsidian/attachment';
import { createDeletePathTool } from '../../../../src/pi/tools/obsidian/deletePath';
import { createEditNoteTool } from '../../../../src/pi/tools/obsidian/editNote';
import { createMkdirTool } from '../../../../src/pi/tools/obsidian/mkdir';
import { createMovePathTool } from '../../../../src/pi/tools/obsidian/movePath';
import { createOpenPathTool } from '../../../../src/pi/tools/obsidian/openPath';
import { createPropertiesTool } from '../../../../src/pi/tools/obsidian/properties';
import { createReadNoteTool } from '../../../../src/pi/tools/obsidian/readNote';
import { createSearchTool } from '../../../../src/pi/tools/obsidian/search';
import { createTasksTool } from '../../../../src/pi/tools/obsidian/tasks';
import { createWriteNoteTool } from '../../../../src/pi/tools/obsidian/writeNote';
import type { ObsidianToolDeps } from '../../../../src/pi/tools/obsidian/deps';

function makeDeps(overrides: Partial<ObsidianToolDeps> = {}): ObsidianToolDeps {
  return {
    vault: {
      createFolder: jest.fn().mockResolvedValue({ path: 'notes/new' }),
      editNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', replacements: 1 }),
      getAttachmentInfo: jest.fn().mockResolvedValue({ availablePath: 'assets/a.png' }),
      movePath: jest.fn().mockResolvedValue({ path: 'notes/a.md', newPath: 'notes/b.md' }),
      openPath: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
      readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'content' }),
      searchNotes: jest.fn().mockResolvedValue([]),
      trashPath: jest.fn().mockResolvedValue({ path: 'notes/a.md', kind: 'file' }),
      writeNote: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
    } as never,
    cli: { run: jest.fn().mockResolvedValue('ok') } as never,
    settings: { cliEnabled: true } as never,
    vaultName: 'vault',
    approve: null,
    ...overrides,
  };
}

describe('obsidian tool input hardening', () => {
  it('rejects non-string write content instead of stringifying objects', async () => {
    const deps = makeDeps();
    const tool = createWriteNoteTool(deps);

    await expect(tool.execute('call', {
      path: 'notes/a.md',
      content: { text: 'bad' },
      mode: 'overwrite',
    })).rejects.toThrow('content and mode are required strings');
    expect(deps.vault.writeNote).not.toHaveBeenCalled();
  });

  it('omits object-valued task fields instead of passing [object Object] to CLI', async () => {
    const deps = makeDeps();
    const tool = createTasksTool(deps);

    await tool.execute('call', {
      action: 'list',
      file: { path: 'bad.md' },
      path: ['bad.md'],
      todo: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['tasks', 'format=json', 'todo'],
    });
  });

  it('rejects non-string property values instead of coercing to empty strings', async () => {
    const deps = makeDeps();
    const tool = createPropertiesTool(deps);

    await expect(tool.execute('call', {
      action: 'set',
      name: 'status',
      path: 'notes/a.md',
      value: { state: 'bad' },
    })).rejects.toThrow('value must be a string');

    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects object-valued read note paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createReadNoteTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
    })).rejects.toThrow('file or path must be a string');
    expect(deps.vault.readNote).not.toHaveBeenCalled();
  });

  it('rejects object-valued edit note paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
      old_string: 'a',
      new_string: 'b',
    })).rejects.toThrow('file or path must be a string');
    expect(deps.vault.editNote).not.toHaveBeenCalled();
  });

  it('rejects object-valued search query before API or CLI fallback', async () => {
    const deps = makeDeps();
    const tool = createSearchTool(deps);

    await expect(tool.execute('call', {
      query: { text: 'bad' },
      format: 'text',
    })).rejects.toThrow('query must be a string');
    expect(deps.vault.searchNotes).not.toHaveBeenCalled();
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects object-valued delete paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createDeletePathTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
    })).rejects.toThrow('file or path must be a string');
    expect(deps.vault.trashPath).not.toHaveBeenCalled();
  });

  it('rejects object-valued move paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createMovePathTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
      newPath: 'notes/b.md',
    })).rejects.toThrow('path and newPath must be strings');
    expect(deps.vault.movePath).not.toHaveBeenCalled();
  });

  it('rejects object-valued mkdir paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createMkdirTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad' },
    })).rejects.toThrow('path must be a string');
    expect(deps.vault.createFolder).not.toHaveBeenCalled();
  });

  it('rejects object-valued open paths before vault access', async () => {
    const deps = makeDeps();
    const tool = createOpenPathTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
    })).rejects.toThrow('path must be a string');
    expect(deps.vault.openPath).not.toHaveBeenCalled();
  });

  it('rejects object-valued attachment inputs before vault access', async () => {
    const deps = makeDeps();
    const tool = createAttachmentTool(deps);

    await expect(tool.execute('call', {
      filename: { text: 'bad.png' },
    })).rejects.toThrow('path or filename must be a string');
    expect(deps.vault.getAttachmentInfo).not.toHaveBeenCalled();
  });
});
