import { createAttachmentTool } from '@pivi/obsidian-tools';
import { createBaseTool } from '@pivi/obsidian-tools';
import { createDailyTool } from '@pivi/obsidian-tools';
import { createDeletePathTool } from '@pivi/obsidian-tools';
import { createEditNoteTool } from '@pivi/obsidian-tools';
import { createGraphTool } from '@pivi/obsidian-tools';
import { createMarkdownStructureTool } from '@pivi/obsidian-tools';
import { createMkdirTool } from '@pivi/obsidian-tools';
import { createMovePathTool } from '@pivi/obsidian-tools';
import { createNoteInfoTool } from '@pivi/obsidian-tools';
import { createOpenPathTool } from '@pivi/obsidian-tools';
import { createPropertiesTool } from '@pivi/obsidian-tools';
import { createReadExternalTool } from '@pivi/obsidian-tools';
import { createReadNoteTool } from '@pivi/obsidian-tools';
import { createSearchTool } from '@pivi/obsidian-tools';
import { createTagsTool } from '@pivi/obsidian-tools';
import { createTasksTool } from '@pivi/obsidian-tools';
import { createWriteNoteTool } from '@pivi/obsidian-tools';
import type { ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(overrides: Partial<ObsidianToolDeps> = {}): ObsidianToolDeps {
  return {
    vault: {
      createFolder: jest.fn().mockResolvedValue({ path: 'notes/new' }),
      editNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', replacements: 1 }),
      getBaseFiles: jest.fn().mockReturnValue([]),
      getBaseViews: jest.fn().mockResolvedValue({ path: 'bases/a.base', views: [] }),
      getGraphAnalysis: jest.fn().mockReturnValue({ orphans: [], deadends: [], unresolved: [] }),
      getAttachmentInfo: jest.fn().mockResolvedValue({ availablePath: 'assets/a.png' }),
      getNoteInfo: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
      getRecentFiles: jest.fn().mockReturnValue([]),
      getTagInfo: jest.fn().mockReturnValue({ name: 'project', count: 0 }),
      getTags: jest.fn().mockReturnValue([]),
      movePath: jest.fn().mockResolvedValue({ path: 'notes/a.md', newPath: 'notes/b.md' }),
      openPath: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
      readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'content' }),
      searchNotes: jest.fn().mockResolvedValue([]),
      trashPath: jest.fn().mockResolvedValue({ path: 'notes/a.md', kind: 'file' }),
      writeNote: jest.fn().mockResolvedValue({ path: 'notes/a.md' }),
    } as never,
    externalFiles: {
      readFile: jest.fn().mockResolvedValue({ path: '/tmp/file.txt', content: 'external content' }),
      listPath: jest.fn().mockReturnValue([]),
      stat: jest.fn().mockReturnValue({ path: '/tmp/file.txt', size: 'external content'.length, isDirectory: false, isFile: true }),
    },
    cli: { run: jest.fn().mockResolvedValue('ok') } as never,
    settings: { cliEnabled: true } as never,
    vaultName: 'vault',
    processRunner: { run: jest.fn() },
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

  it('rejects object-valued external read paths before filesystem access', async () => {
    const deps = makeDeps();
    const tool = createReadExternalTool(deps);

    await expect(tool.execute('call', {
      path: { nested: '/tmp/bad.txt' },
    })).rejects.toThrow('path must be an absolute string');
    expect(deps.externalFiles.readFile).not.toHaveBeenCalled();
  });

  it('returns external file byte stats without reading large files by default', async () => {
    const deps = makeDeps({
      externalFiles: {
        stat: jest.fn().mockReturnValue({ path: '/tmp/large.log', size: 25_000, isDirectory: false, isFile: true }),
        readFile: jest.fn(),
        listPath: jest.fn(),
      },
    });
    const tool = createReadExternalTool(deps);

    const result = await tool.execute('call', {
      path: '/tmp/large.log',
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toContain('Bytes: 25000');
    expect(result.content[0].text).toContain('Large external file');
    expect(result.details).toMatchObject({ path: '/tmp/large.log', bytes: 25_000, truncated: true });
    expect(deps.externalFiles.readFile).not.toHaveBeenCalled();
  });

  it('rejects external files above the hard safety limit when maxChars is raised', async () => {
    const deps = makeDeps({
      externalFiles: {
        stat: jest.fn().mockReturnValue({ path: '/tmp/huge.log', size: 10_000_001, isDirectory: false, isFile: true }),
        readFile: jest.fn(),
        listPath: jest.fn(),
      },
    });
    const tool = createReadExternalTool(deps);

    await expect(tool.execute('call', {
      path: '/tmp/huge.log',
      maxChars: 10_000_001,
    })).rejects.toThrow('hard safety limit');
    expect(deps.externalFiles.readFile).not.toHaveBeenCalled();
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

  it('preserves original line terminators for selected line ranges', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'one\r\ntwo\r\nthree\r\n' }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/a.md',
      startLine: 2,
      endLine: 2,
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toBe('two\r\n');
    expect(result.details).toMatchObject({ selectedRange: { lines: 1, characters: 5 } });
  });

  it('returns both whole-file and selected-range stats for stats range reads', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', content: 'one\ntwo\nthree\n' }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/a.md',
      mode: 'stats',
      startLine: 2,
      endLine: 2,
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toContain('Lines: 3');
    expect(result.content[0].text).toContain('Characters: 14');
    expect(result.content[0].text).toContain('Selected range:');
    expect(result.content[0].text).toContain('Start line: 2');
    expect(result.content[0].text).toContain('End line: 2');
    expect(result.content[0].text).toContain('Lines: 1');
    expect(result.content[0].text).toContain('Characters: 4');
    expect(result.details).toMatchObject({
      wholeFile: { lines: 3, characters: 14 },
      selectedRange: { lines: 1, characters: 4, startLine: 2, endLine: 2 },
    });
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
    expect(result.content[0].text).toContain(`maxChars set to at least ${content.length}`);
    expect(result.content[0].text).not.toContain('SECRET_CONTENT');
    expect(result.details.truncated).toBe(true);
  });

  it('can deliberately return a full large note when maxChars is raised', async () => {
    const content = `${'x'.repeat(21_000)}\nSECRET_CONTENT`;
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({ path: 'notes/large.md', content }),
      } as never,
    });
    const tool = createReadNoteTool(deps);

    const result = await tool.execute('call', {
      path: 'notes/large.md',
      maxChars: content.length,
    }) as { content: [{ text: string }]; details: Record<string, unknown> };

    expect(result.content[0].text).toContain('SECRET_CONTENT');
    expect(result.details.truncated).toBe(false);
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

  it('extracts Setext headings outside fenced code blocks', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({
          path: 'notes/setext.md',
          content: 'Title\n=====\nbody\n```\nIgnored\n-------\n```\nSection\n-------\n',
        }),
      } as never,
    });
    const tool = createMarkdownStructureTool(deps);

    const result = await tool.execute('call', { path: 'notes/setext.md' }) as { content: [{ text: string }] };
    const parsed = JSON.parse(result.content[0].text) as {
      headings: Array<{ level: number; text: string; line: number }>;
    };

    expect(parsed.headings).toEqual([
      expect.objectContaining({ level: 1, text: 'Title', line: 1 }),
      expect.objectContaining({ level: 2, text: 'Section', line: 8 }),
    ]);
  });

  it('tracks fenced code blocks by marker character and opening fence length', async () => {
    const deps = makeDeps({
      vault: {
        readNote: jest.fn().mockResolvedValue({
          path: 'notes/fences.md',
          content: '````\n# ignored\n````js\n# still ignored\n```\n# still ignored too\n````\n# Real\n~~~\n# tilde ignored\n```\n# still tilde ignored\n~~~\n## Real 2\n',
        }),
      } as never,
    });
    const tool = createMarkdownStructureTool(deps);

    const result = await tool.execute('call', { path: 'notes/fences.md' }) as { content: [{ text: string }] };
    const parsed = JSON.parse(result.content[0].text) as {
      headings: Array<{ level: number; text: string; line: number }>;
    };

    expect(parsed.headings).toEqual([
      expect.objectContaining({ level: 1, text: 'Real', line: 8 }),
      expect.objectContaining({ level: 2, text: 'Real 2', line: 14 }),
    ]);
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

  it('uses the vault API for base list/views and reserves CLI for base queries', async () => {
    const deps = makeDeps({
      vault: {
        getBaseFiles: jest.fn().mockReturnValue([{ path: 'bases/a.base', basename: 'a', size: 10, mtime: 2 }]),
        getBaseViews: jest.fn().mockResolvedValue({
          path: 'bases/a.base',
          views: [{ name: 'Table', type: 'table', columns: ['file'] }],
        }),
      } as never,
    });
    const tool = createBaseTool(deps);

    await tool.execute('call', { action: 'list' });
    expect(deps.vault.getBaseFiles).toHaveBeenCalled();
    expect(deps.cli.run).not.toHaveBeenCalled();

    await tool.execute('call', { action: 'views', path: 'bases/a.base' });
    expect(deps.vault.getBaseViews).toHaveBeenCalledWith(undefined, 'bases/a.base');
    expect(deps.cli.run).not.toHaveBeenCalled();

    await tool.execute('call', { action: 'query', path: 'bases/a.base', format: 'paths' });
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['base:query', 'format=paths', 'path=bases/a.base'],
    });
  });

  it('removes base query from schema and rejects it when Obsidian CLI is unavailable', async () => {
    const deps = makeDeps({ obsidianCliAvailable: false });
    const tool = createBaseTool(deps);

    const actionSchema = (tool.parameters.properties as Record<string, { enum?: string[] }>).action;
    expect(actionSchema).toBeDefined();
    if (!actionSchema) throw new Error('Expected an action schema');
    expect(actionSchema.enum).toEqual(['list', 'views']);

    await expect(tool.execute('call', {
      action: 'query',
      path: 'bases/a.base',
    })).rejects.toThrow('Query requires Obsidian CLI');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects invalid base formats before invoking the CLI', async () => {
    const deps = makeDeps();
    const tool = createBaseTool(deps);

    await expect(tool.execute('call', {
      action: 'query',
      path: 'bases/a.base',
      format: 'yaml',
    })).rejects.toThrow('Invalid base format');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects invalid daily actions and missing daily content', async () => {
    const deps = makeDeps();
    const tool = createDailyTool(deps);

    await expect(tool.execute('call', { action: 'delete' })).rejects.toThrow('Invalid daily action');
    await expect(tool.execute('call', { action: 'append' })).rejects.toThrow('content is required for append');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects invalid graph actions and limits before metadata access', async () => {
    const deps = makeDeps();
    const tool = createGraphTool(deps);

    await expect(tool.execute('call', { actions: 'orphans,invalid' })).rejects.toThrow('Invalid graph action');
    await expect(tool.execute('call', { limit: 0 })).rejects.toThrow('limit must be a positive integer');
    expect(deps.vault.getGraphAnalysis).not.toHaveBeenCalled();
  });

  it('rejects invalid tag inputs before metadata access', async () => {
    const deps = makeDeps();
    const tool = createTagsTool(deps);

    await expect(tool.execute('call', { action: 'list', sort: 'path' })).rejects.toThrow('Invalid tags sort');
    await expect(tool.execute('call', { action: 'info' })).rejects.toThrow('name is required');
    expect(deps.vault.getTags).not.toHaveBeenCalled();
    expect(deps.vault.getTagInfo).not.toHaveBeenCalled();
  });

  it('rejects invalid note-info actions before API or CLI fallback', async () => {
    const deps = makeDeps();
    const tool = createNoteInfoTool(deps);

    await expect(tool.execute('call', { action: 'stats' })).rejects.toThrow('Invalid note info action');
    expect(deps.vault.getNoteInfo).not.toHaveBeenCalled();
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('rejects object-valued note-info paths before API or CLI fallback', async () => {
    const deps = makeDeps();
    const tool = createNoteInfoTool(deps);

    await expect(tool.execute('call', {
      path: { nested: 'bad.md' },
    })).rejects.toThrow('file or path must be a string');
    expect(deps.vault.getNoteInfo).not.toHaveBeenCalled();
    expect(deps.cli.run).not.toHaveBeenCalled();
  });

  it('does not use CLI fallback when the official Obsidian CLI is unavailable', async () => {
    const apiError = new Error('api failed');
    const deps = makeDeps({
      obsidianCliAvailable: false,
      vault: {
        getNoteInfo: jest.fn().mockRejectedValue(apiError),
        searchNotes: jest.fn().mockRejectedValue(apiError),
      } as never,
    });

    await expect(createNoteInfoTool(deps).execute('call', { path: 'notes/a.md' }))
      .rejects.toThrow('api failed');
    await expect(createSearchTool(deps).execute('call', { query: 'project' }))
      .rejects.toThrow('api failed');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
