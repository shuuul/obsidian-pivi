import { TFile, TFolder } from 'obsidian';

import { ObsidianVaultApi } from '@pivi/obsidian-host';

function makeApp(
  files: Array<{ path: string; content: string; tags?: string[]; frontmatter?: Record<string, unknown> }>,
  folders: string[] = [],
  options: {
    fileRecoveryEnabled?: boolean;
    forceAdd?: jest.Mock;
    failForceAdd?: boolean;
  } = {},
) {
  const byPath = new Map(files.map((f) => [f.path, { ...f }]));
  const trashed: string[] = [];
  const moved: Array<{ path: string; newPath: string }> = [];
  const opened: string[] = [];
  const listed: string[] = [];
  const modified: string[] = [];
  const binaries = new Map<string, ArrayBuffer>();

  function makeFile(path: string): TFile {
    const file = new TFile();
    const entry = byPath.get(path);
    Object.assign(file, {
      path,
      name: path.split('/').pop() ?? path,
      extension: path.split('.').pop() ?? '',
      basename: path.replace(/\.[^.]+$/, '').split('/').pop() ?? path,
      stat: { size: entry?.content.length ?? 0, ctime: 1, mtime: 2 },
    });
    return file;
  }

  function makeFolder(path: string): TFolder {
    const folder = new TFolder();
    Object.assign(folder, { path, name: path.split('/').pop() ?? path, children: [] });
    return folder;
  }

  const forceAdd = options.forceAdd ?? jest.fn(async () => undefined);
  if (options.failForceAdd) {
    forceAdd.mockRejectedValue(new Error('forceAdd failed'));
  }

  const app = {
    getContent(path: string): string {
      return byPath.get(path)?.content ?? '';
    },
    getTrashed(): string[] {
      return [...trashed];
    },
    getMoved(): Array<{ path: string; newPath: string }> {
      return [...moved];
    },
    getOpened(): string[] {
      return [...opened];
    },
    getListed(): string[] {
      return [...listed];
    },
    getModified(): string[] {
      return [...modified];
    },
    fileManager: {
      trashFile: async (file: { path: string }) => {
        trashed.push(file.path);
      },
      renameFile: async (file: { path: string }, newPath: string) => {
        moved.push({ path: file.path, newPath });
      },
      processFrontMatter: async (file: { path: string }, fn: (frontmatter: Record<string, unknown>) => void) => {
        const entry = byPath.get(file.path);
        const stored = entry as typeof entry & { frontmatter?: Record<string, unknown> };
        const frontmatter = { ...(stored?.frontmatter ?? {}) } as Record<string, unknown>;
        fn(frontmatter);
        if (entry) {
          stored.frontmatter = frontmatter;
        }
      },
      getAvailablePathForAttachment: async (filename: string, sourcePath?: string) => (
        sourcePath ? `assets/${sourcePath}-${filename}` : `assets/${filename}`
      ),
      generateMarkdownLink: (file: { path: string }) => `![[${file.path}]]`,
    },
    vault: {
      process: async (file: { path: string }, fn: (data: string) => string) => {
        const entry = byPath.get(file.path);
        if (!entry) {
          throw new Error(`missing file ${file.path}`);
        }
        entry.content = fn(entry.content);
      },
      getFiles: () => files.map((file) => makeFile(file.path)),
      getMarkdownFiles: () => files
        .filter((f) => f.path.endsWith('.md'))
        .map((f) => ({
          path: f.path,
          basename: f.path.replace(/\.md$/, '').split('/').pop(),
          extension: 'md',
          stat: { size: f.content.length, ctime: 1, mtime: 2 },
        })),
      createFolder: async (path: string) => {
        folders.push(path);
        return makeFolder(path);
      },
      create: async (path: string, content: string) => {
        byPath.set(path, { path, content });
        return makeFile(path);
      },
      createBinary: async (path: string, data: ArrayBuffer) => {
        binaries.set(path, data);
        const file = makeFile(path);
        Object.assign(file, { stat: { size: data.byteLength, ctime: 1, mtime: 2 } });
        byPath.set(path, { path, content: '<binary>' });
        return file;
      },
      getRoot: () => {
        const root = makeFolder('');
        root.children = [
          ...folders.map((path) => makeFolder(path)),
          ...files.map((file) => makeFile(file.path)),
        ];
        return root;
      },
      getResourcePath: (file: { path: string }) => `app://resource/${file.path}`,
      cachedRead: async (file: { path: string }) => byPath.get(file.path)?.content ?? '',
      getAbstractFileByPath: (path: string) => {
        if (folders.includes(path)) {
          const folder = makeFolder(path);
          folder.children = files
            .filter((file) => file.path.startsWith(`${path}/`))
            .map((file) => makeFile(file.path));
          return folder;
        }
        if (!byPath.has(path)) {
          return null;
        }
        return makeFile(path);
      },
      adapter: {
        list: async (path: string) => {
          listed.push(path);
          return { files: [], folders: [] };
        },
      },
      trigger: (_event: string, file: { path: string }) => {
        modified.push(file.path);
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => {
        const direct = byPath.has(link) ? link : null;
        const markdown = byPath.has(`${link}.md`) ? `${link}.md` : null;
        const basename = [...byPath.keys()].find((candidate) => (
          candidate.split('/').pop() === link
        ));
        const resolved = direct ?? markdown ?? basename;
        return resolved ? makeFile(resolved) : null;
      },
      getFileCache: (file: { path: string }) => {
        const meta = byPath.get(file.path);
        if (!meta) {
          return null;
        }
        return {
          tags: meta.tags?.map((tag) => ({ tag, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } })),
          links: [],
          frontmatter: (meta as typeof meta & { frontmatter?: Record<string, unknown> }).frontmatter ?? { title: meta.path },
        };
      },
      resolvedLinks: {
        'other.md': { 'target.md': 1 },
      },
      unresolvedLinks: {
        'source.md': { Missing: 2 },
      },
    },
    workspace: {
      getActiveFile: () => null,
      getLastOpenFiles: () => [...opened],
      getLeaf: () => ({
        openFile: async (file: { path: string }) => {
          opened.push(file.path);
        },
      }),
      setActiveLeaf: jest.fn(),
    },
    internalPlugins: {
      getEnabledPluginById: (id: string) => (
        options.fileRecoveryEnabled === false || id !== 'file-recovery'
          ? null
          : { forceAdd }
      ),
    },
  };
  return Object.assign(app, {
    getBinary(path: string): ArrayBuffer | undefined {
      return binaries.get(path);
    },
    getForceAdd(): jest.Mock {
      return forceAdd;
    },
  });
}

jest.mock('obsidian', () => {
  const obsidian = jest.requireActual<typeof import('../../__mocks__/obsidian')>('../../__mocks__/obsidian');
  return {
    ...obsidian,
    getAllTags: (cache: { tags?: Array<{ tag: string }> }) => cache.tags?.map((t) => t.tag) ?? null,
  };
});

describe('ObsidianVaultApi', () => {
  it('searchNotes finds plain text matches with line numbers', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'hello world\nsecond line' },
      { path: 'notes/b.md', content: 'nothing here' },
    ]) as never);

    const hits = await api.searchNotes({ query: 'hello', limit: 10 });
    expect(hits).toEqual([{ path: 'notes/a.md', line: 1 }]);
  });

  it('getNoteInfo returns metadata from cache', async () => {
    const api = new ObsidianVaultApi(makeApp([
      {
        path: 'target.md',
        content: '# x\nhello world',
        tags: ['#project'],
        frontmatter: { title: 'target.md', aliases: ['Target alias'] },
      },
    ]) as never);

    const info = await api.getNoteInfo(undefined, 'target.md');
    expect(info.path).toBe('target.md');
    expect(info.tags).toContain('#project');
    expect(info.frontmatter).toEqual({ title: 'target.md', aliases: ['Target alias'] });
    expect(info.wordCount).toBe(4);
    expect(info.characterCount).toBe('# x\nhello world'.length);
    expect(info.aliases).toEqual(['Target alias']);
  });

  it('lists base files and parses configured base views via the vault API', async () => {
    const baseContent = 'views: [{"name":"Table","type":"table","order":["file","status"]}]';
    const api = new ObsidianVaultApi(makeApp([
      { path: 'bases/projects.base', content: baseContent },
      { path: 'notes/a.md', content: 'x' },
    ]) as never);

    expect(api.getBaseFiles()).toEqual([
      { path: 'bases/projects.base', basename: 'projects', size: baseContent.length, mtime: 2 },
    ]);

    await expect(api.getBaseViews(undefined, 'bases/projects.base')).resolves.toEqual({
      path: 'bases/projects.base',
      views: [{ name: 'Table', type: 'table', columns: ['file', 'status'] }],
    });

    await expect(api.getBaseViews('projects')).resolves.toEqual({
      path: 'bases/projects.base',
      views: [{ name: 'Table', type: 'table', columns: ['file', 'status'] }],
    });
  });

  it('resolves a base file without enumerating the vault', async () => {
    const app = makeApp([
      { path: 'bases/projects.base', content: 'views: []' },
      { path: 'notes/a.md', content: 'x' },
    ]);
    const getFiles = jest.spyOn(app.vault, 'getFiles');
    const api = new ObsidianVaultApi(app as never);

    await expect(api.getBaseViews('projects')).resolves.toEqual({
      path: 'bases/projects.base',
      views: [],
    });
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('indexes tags and returns verbose tag file details', () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'x', tags: ['#project', '#area'] },
      { path: 'notes/b.md', content: 'y', tags: ['#project'] },
    ]) as never);

    expect(api.getTags('count')).toEqual([
      { name: 'project', count: 2 },
      { name: 'area', count: 1 },
    ]);
    expect(api.getTagInfo('#project', true)).toEqual({
      name: 'project',
      count: 2,
      files: ['notes/a.md', 'notes/b.md'],
    });
  });

  it('analyzes graph metadata without shelling out to the CLI', () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'target.md', content: '' },
      { path: 'other.md', content: '' },
    ]) as never);

    expect(api.getGraphAnalysis(['orphans', 'unresolved'])).toEqual({
      orphans: ['other.md'],
      deadends: [],
      unresolved: [{ source: 'source.md', target: 'Missing', count: 2 }],
    });
  });

  it('returns unresolved links without enumerating vault files', () => {
    const app = makeApp([
      { path: 'target.md', content: '' },
      { path: 'other.md', content: '' },
    ]);
    const getFiles = jest.spyOn(app.vault, 'getFiles');
    const getMarkdownFiles = jest.spyOn(app.vault, 'getMarkdownFiles');
    const api = new ObsidianVaultApi(app as never);

    expect(api.getGraphAnalysis(['unresolved'])).toEqual({
      orphans: [],
      deadends: [],
      unresolved: [{ source: 'source.md', target: 'Missing', count: 2 }],
    });
    expect(getFiles).not.toHaveBeenCalled();
    expect(getMarkdownFiles).not.toHaveBeenCalled();
  });

  it('searchNotes lists files when query is * with path scope', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'month/2026-2.md', content: 'journal entry' },
      { path: 'other/note.md', content: 'elsewhere' },
    ]) as never);

    const hits = await api.searchNotes({ query: '*', path: 'month', limit: 10 });
    expect(hits).toEqual([{ path: 'month/2026-2.md' }]);
  });

  it('searchNotes lists files for path: prefix without text needle', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'month/2026-2.md', content: 'x' },
      { path: 'month/extra.md', content: 'y' },
    ]) as never);

    const hits = await api.searchNotes({ query: 'path:month', limit: 10 });
    expect(hits.map((h) => h.path).sort()).toEqual(['month/2026-2.md', 'month/extra.md']);
  });

  it('getLinks returns backlinks from resolvedLinks', () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'target.md', content: '' },
      { path: 'other.md', content: '' },
    ]) as never);

    const result = api.getLinks(undefined, 'target.md', 'backlinks');
    expect(result.links).toEqual([{ path: 'other.md', count: 1 }]);
  });

  it('editNote replaces a unique substring', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'hello world' }]);
    const api = new ObsidianVaultApi(app as never);

    const result = await api.editNote({
      path: 'notes/a.md',
      old_string: 'world',
      new_string: 'vault',
    });

    expect(result).toMatchObject({ path: 'notes/a.md', replacements: 1 });
    expect(app.getContent('notes/a.md')).toBe('hello vault');
  });

  it('editNote throws when old_string is missing', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'hello' },
    ]) as never);

    await expect(api.editNote({
      path: 'notes/a.md',
      old_string: 'missing',
      new_string: 'x',
    })).rejects.toThrow(/not found/);
  });

  it('editNote hints when ASCII quotes differ from curly vault quotes', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: '松散的联系“弱关系”理论' },
    ]) as never);

    await expect(api.editNote({
      path: 'notes/a.md',
      old_string: '松散的联系"弱关系"理论',
      new_string: 'x',
    })).rejects.toThrow(/curly quotes/);
  });

  it('editNote throws on ambiguous match without replace_all', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'foo bar foo' },
    ]) as never);

    await expect(api.editNote({
      path: 'notes/a.md',
      old_string: 'foo',
      new_string: 'baz',
    })).rejects.toThrow(/appears 2 times/);
  });

  it('editNote replace_all updates every occurrence', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'foo bar foo' }]);
    const api = new ObsidianVaultApi(app as never);

    const result = await api.editNote({
      path: 'notes/a.md',
      old_string: 'foo',
      new_string: 'baz',
      replace_all: true,
    });

    expect(result.replacements).toBe(2);
    expect(app.getContent('notes/a.md')).toBe('baz bar baz');
  });

  it('editNote rejects empty old_string', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'hello' },
    ]) as never);

    await expect(api.editNote({
      path: 'notes/a.md',
      old_string: '',
      new_string: 'x',
    })).rejects.toThrow(/must not be empty/);
  });

  it('writeNote append uses vault.process', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'line1\n' }]);
    const api = new ObsidianVaultApi(app as never);

    await api.writeNote({
      path: 'notes/a.md',
      content: 'line2\n',
      mode: 'append',
    });

    expect(app.getContent('notes/a.md')).toBe('line1\nline2\n');
  });

  it('trashPath moves a file to trash through FileManager', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'x' }]);
    const api = new ObsidianVaultApi(app as never);

    const result = await api.trashPath({ path: 'notes/a.md' });

    expect(result).toEqual({ path: 'notes/a.md', kind: 'file' });
    expect(app.getTrashed()).toEqual(['notes/a.md']);
  });

  it('trashPath moves a folder to trash through FileManager', async () => {
    const app = makeApp([], ['notes/archive']);
    const api = new ObsidianVaultApi(app as never);

    const result = await api.trashPath({ path: 'notes/archive' });

    expect(result).toEqual({ path: 'notes/archive', kind: 'folder' });
    expect(app.getTrashed()).toEqual(['notes/archive']);
  });

  it('movePath renames through FileManager', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'x' }]);
    const api = new ObsidianVaultApi(app as never);

    await api.movePath({ path: 'notes/a.md', newPath: 'archive/a.md' });

    expect(app.getMoved()).toEqual([{ path: 'notes/a.md', newPath: 'archive/a.md' }]);
  });

  it('createFolder uses vault.createFolder', async () => {
    const app = makeApp([]);
    const api = new ObsidianVaultApi(app as never);

    const result = await api.createFolder('notes/new');

    expect(result).toEqual({ path: 'notes/new' });
    expect(api.listPath('').some((entry) => entry.path === 'notes/new')).toBe(true);
  });

  it('listPath returns files and folders', () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'notes/a.md', content: 'x' },
    ], ['notes']) as never);

    expect(api.listPath('').map((entry) => entry.path).sort()).toEqual(['notes', 'notes/a.md']);
    expect(api.listPath('notes')).toEqual([
      { path: 'notes/a.md', kind: 'file', name: 'a.md', extension: 'md', size: 1 },
    ]);
  });

  it('openPath opens a file in the workspace', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'x' }]);
    const api = new ObsidianVaultApi(app as never);

    await api.openPath('notes/a.md', 'tab');

    expect(app.getOpened()).toEqual(['notes/a.md']);
  });

  it('getAttachmentInfo returns resource path for existing attachments', async () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'assets/image.png', content: 'binary' },
    ]) as never);

    await expect(api.getAttachmentInfo({ path: 'assets/image.png' })).resolves.toMatchObject({
      path: 'assets/image.png',
      resourcePath: 'app://resource/assets/image.png',
      markdown: '![[assets/image.png]]',
      extension: 'png',
    });
  });

  it('writeAttachment creates a binary vault attachment and returns embed metadata', async () => {
    const app = makeApp([]);
    const api = new ObsidianVaultApi(app as never);
    const data = new Uint8Array([1, 2, 3]).buffer;

    const result = await api.writeAttachment({
      filename: 'image.png',
      sourcePath: 'note.md',
      data,
    });

    expect(result).toMatchObject({
      path: 'assets/note.md-image.png',
      markdown: '![[assets/note.md-image.png]]',
      resourcePath: 'app://resource/assets/note.md-image.png',
      extension: 'png',
      size: 3,
    });
    expect(app.getBinary('assets/note.md-image.png')).toBe(data);
  });

  it('getAttachmentInfo asks Obsidian for an available path', async () => {
    const api = new ObsidianVaultApi(makeApp([]) as never);

    await expect(api.getAttachmentInfo({ filename: 'image.png', sourcePath: 'note.md' })).resolves.toEqual({
      availablePath: 'assets/note.md-image.png',
    });
  });

  it('setProperty and removeProperty use FileManager frontmatter processing', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'x' }]);
    const api = new ObsidianVaultApi(app as never);

    await api.setProperty(undefined, 'notes/a.md', 'status', 'draft');
    expect(api.getProperties(undefined, 'notes/a.md', 'status').value).toBe('draft');

    await api.removeProperty(undefined, 'notes/a.md', 'status');
    expect(api.getProperties(undefined, 'notes/a.md', 'status').value).toBeUndefined();
  });

  it('triggerVaultModify scans the vault root for missing root files', async () => {
    const app = makeApp([]);
    const api = new ObsidianVaultApi(app as never);

    api.triggerVaultModify('new-note.md');
    await Promise.resolve();

    expect(app.getListed()).toEqual(['']);
    expect(app.getModified()).toEqual([]);
  });

  it('editNote captures a File Recovery snapshot before mutating', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'hello world' }], [], {
      fileRecoveryEnabled: true,
    });
    const api = new ObsidianVaultApi(app as never);

    await api.editNote({
      path: 'notes/a.md',
      old_string: 'world',
      new_string: 'vault',
    });

    expect(app.getForceAdd()).toHaveBeenCalledWith('notes/a.md', 'hello world');
    expect(app.getContent('notes/a.md')).toBe('hello vault');
  });

  it('writeNote create skips File Recovery snapshots', async () => {
    const app = makeApp([], [], { fileRecoveryEnabled: true });
    const api = new ObsidianVaultApi(app as never);

    await api.writeNote({
      path: 'notes/new.md',
      content: 'created',
      mode: 'create',
    });

    expect(app.getForceAdd()).not.toHaveBeenCalled();
    expect(app.getContent('notes/new.md')).toBe('created');
  });

  it('writeNote overwrite captures a File Recovery snapshot', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'before' }], [], {
      fileRecoveryEnabled: true,
    });
    const api = new ObsidianVaultApi(app as never);

    await api.writeNote({
      path: 'notes/a.md',
      content: 'after',
      mode: 'overwrite',
    });

    expect(app.getForceAdd()).toHaveBeenCalledWith('notes/a.md', 'before');
    expect(app.getContent('notes/a.md')).toBe('after');
  });

  it('setProperty captures a File Recovery snapshot before frontmatter mutation', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'body' }], [], {
      fileRecoveryEnabled: true,
    });
    const api = new ObsidianVaultApi(app as never);

    await api.setProperty(undefined, 'notes/a.md', 'status', 'draft');

    expect(app.getForceAdd()).toHaveBeenCalledWith('notes/a.md', 'body');
  });

  it('editNote still mutates when File Recovery snapshot capture fails', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'hello world' }], [], {
      fileRecoveryEnabled: true,
      failForceAdd: true,
    });
    const api = new ObsidianVaultApi(app as never);

    await api.editNote({
      path: 'notes/a.md',
      old_string: 'world',
      new_string: 'vault',
    });

    expect(app.getContent('notes/a.md')).toBe('hello vault');
  });

  it('editNote still mutates when File Recovery is unavailable', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'hello world' }], [], {
      fileRecoveryEnabled: false,
    });
    const api = new ObsidianVaultApi(app as never);

    await api.editNote({
      path: 'notes/a.md',
      old_string: 'world',
      new_string: 'vault',
    });

    expect(app.getContent('notes/a.md')).toBe('hello vault');
  });
});
