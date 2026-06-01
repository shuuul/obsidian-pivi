import { TFile } from 'obsidian';

import { ObsidianVaultApi } from '../../../src/pi/tools/ObsidianVaultApi';

function makeApp(files: Array<{ path: string; content: string; tags?: string[] }>) {
  const byPath = new Map(files.map((f) => [f.path, { ...f }]));
  const app = {
    getContent(path: string): string {
      return byPath.get(path)?.content ?? '';
    },
    vault: {
      process: async (file: { path: string }, fn: (data: string) => string) => {
        const entry = byPath.get(file.path);
        if (!entry) {
          throw new Error(`missing file ${file.path}`);
        }
        entry.content = fn(entry.content);
      },
      getMarkdownFiles: () => files.map((f) => ({
        path: f.path,
        basename: f.path.replace(/\.md$/, '').split('/').pop(),
        extension: 'md',
        stat: { size: f.content.length, ctime: 1, mtime: 2 },
      })),
      cachedRead: async (file: { path: string }) => byPath.get(file.path)?.content ?? '',
      getAbstractFileByPath: (path: string) => {
        if (!byPath.has(path)) {
          return null;
        }
        const file = new TFile();
        const entry = byPath.get(path);
        Object.assign(file, {
          path,
          extension: 'md',
          basename: path.replace(/\.md$/, '').split('/').pop() ?? path,
          stat: { size: entry?.content.length ?? 0, ctime: 1, mtime: 2 },
        });
        return file;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => (byPath.has(`${link}.md`) ? { path: `${link}.md` } : null),
      getFileCache: (file: { path: string }) => {
        const meta = byPath.get(file.path);
        if (!meta) {
          return null;
        }
        return {
          tags: meta.tags?.map((tag) => ({ tag, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } })),
          links: [],
          frontmatter: { title: meta.path },
        };
      },
      resolvedLinks: {
        'other.md': { 'target.md': 1 },
      },
    },
    workspace: { getActiveFile: () => null },
  };
  return app;
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

  it('getNoteInfo returns metadata from cache', () => {
    const api = new ObsidianVaultApi(makeApp([
      { path: 'target.md', content: '# x', tags: ['#project'] },
    ]) as never);

    const info = api.getNoteInfo(undefined, 'target.md');
    expect(info.path).toBe('target.md');
    expect(info.tags).toContain('#project');
    expect(info.frontmatter).toEqual({ title: 'target.md' });
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
    expect(result.structuredPatch.length).toBeGreaterThan(0);
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
});
