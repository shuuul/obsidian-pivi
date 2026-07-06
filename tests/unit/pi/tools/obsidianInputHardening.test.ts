import { createAttachmentTool } from '@pivi/obsidian-tools';
import { createDeletePathTool } from '@pivi/obsidian-tools';
import { createEditNoteTool } from '@pivi/obsidian-tools';
import { createMarkdownStructureTool } from '@pivi/obsidian-tools';
import { createMkdirTool } from '@pivi/obsidian-tools';
import { createMovePathTool } from '@pivi/obsidian-tools';
import { createOpenPathTool } from '@pivi/obsidian-tools';
import { createPropertiesTool } from '@pivi/obsidian-tools';
import { createReadNoteTool } from '@pivi/obsidian-tools';
import { createSearchTool } from '@pivi/obsidian-tools';
import { createTasksTool } from '@pivi/obsidian-tools';
import { createWriteNoteTool } from '@pivi/obsidian-tools';
import type { ObsidianToolDeps } from '@pivi/obsidian-tools';

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

  it('returns read stats without note content when requested', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'one\ntwo\nthree' }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/a.md',
      mode: 'stats',
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toContain('Lines: 3');
    expect(result.content[0].text).toContain('Characters: 13');
    expect(result.content[0].text).not.toContain('one\ntwo\nthree');
    expect(result.details).toMatchObject({ path: 'notes/a.md', lines: 3, characters: 13 });
  });

  it('reads only the requested line range', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'one\ntwo\nthree' }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/a.md',
      startLine: 2,
      endLine: 3,
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toBe('two\nthree');
    expect(result.details).toMatchObject({ startLine: 2, endLine: 3 });
  });

  it('does not return large full-note reads by default', async () => {
    const content = `${'x'.repeat(21_000)}\nSECRET_CONTENT`;
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/large.md', content }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/large.md',
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toContain('Large file: content was not returned');
    expect(result.content[0].text).not.toContain('SECRET_CONTENT');
    expect(result.details.truncated).toBe(true);
  });

  it('extracts markdown heading structure for selective reads', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({
          path: 'notes/a.md',
          content: '# Intro\nbody\n```\n# ignored\n```\n## Details ##\nmore',
        }),
      } as never,
    });
    const tool = createMarkdownStructureTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/a.md',
    }) as { content: [{ text: string }]; details: Record<string, unknown> };
    const parsed = JSON.parse(result.content[0].text) as {
      headings: Array<{ level: number; text: string; line: number; sectionChars: number }>;
      lines: number;
      characters: number;
    };

    expect(parsed.lines).toBe(7);
    expect(parsed.characters).toBe(49);
    expect(parsed.headings).toEqual([
      expect.objectContaining({ level: 1, text: 'Intro', line: 1, sectionChars: 31 }),
      expect.objectContaining({ level: 2, text: 'Details', line: 6, sectionChars: 18 }),
    ]);
    expect(result.details).toMatchObject({ path: 'notes/a.md', totalHeadings: 2 });
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
