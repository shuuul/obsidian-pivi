import { TFile, TFolder } from 'obsidian';

import {
  assertAgentManagedPathMutationAllowed,
  MobileObsidianVaultApi,
  requireMobileAgentVaultMutationPath,
} from '@pivi/obsidian-host/mobile';

function makeApp(
  files: Array<{ path: string; content: string }> = [],
  folders: string[] = [],
) {
  const byPath = new Map(files.map(file => [file.path, { ...file }]));
  const binaries = new Map<string, ArrayBuffer>();
  const trashed: string[] = [];
  const moved: Array<{ path: string; newPath: string }> = [];
  const createdFolders: string[] = [];

  function makeFile(path: string): TFile {
    const file = new TFile();
    const entry = byPath.get(path);
    Object.assign(file, {
      path,
      name: path.split('/').pop() ?? path,
      extension: path.includes('.') ? path.split('.').pop() ?? '' : '',
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

  return {
    binaries,
    trashed,
    moved,
    createdFolders,
    fileManager: {
      trashFile: async (item: { path: string }) => { trashed.push(item.path); },
      renameFile: async (item: { path: string }, newPath: string) => {
        moved.push({ path: item.path, newPath });
      },
      processFrontMatter: async () => undefined,
      getAvailablePathForAttachment: async (filename: string, sourcePath?: string) => (
        sourcePath ? `assets/${sourcePath}-${filename}` : `assets/${filename}`
      ),
      generateMarkdownLink: (file: { path: string }) => `![[${file.path}]]`,
    },
    vault: {
      process: async (file: { path: string }, fn: (data: string) => string) => {
        const entry = byPath.get(file.path);
        if (!entry) throw new Error(`missing ${file.path}`);
        entry.content = fn(entry.content);
      },
      read: async (file: { path: string }) => byPath.get(file.path)?.content ?? '',
      cachedRead: async (file: { path: string }) => byPath.get(file.path)?.content ?? '',
      create: async (path: string, content: string) => {
        byPath.set(path, { path, content });
        return makeFile(path);
      },
      createBinary: async (path: string, data: ArrayBuffer) => {
        binaries.set(path, data);
        byPath.set(path, { path, content: '<binary>' });
        const file = makeFile(path);
        Object.assign(file, { stat: { size: data.byteLength, ctime: 1, mtime: 2 } });
        return file;
      },
      createFolder: async (path: string) => {
        createdFolders.push(path);
        folders.push(path);
        return makeFolder(path);
      },
      getAbstractFileByPath: (path: string) => {
        if (folders.includes(path)) return makeFolder(path);
        return byPath.has(path) ? makeFile(path) : null;
      },
      getResourcePath: (file: { path: string }) => `app://resource/${file.path}`,
      getMarkdownFiles: () => [...byPath.keys()].filter(path => path.endsWith('.md')).map(makeFile),
      getFiles: () => [...byPath.keys()].map(makeFile),
      getRoot: () => makeFolder(''),
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache: () => ({ frontmatter: {}, links: [], tags: [] }),
      resolvedLinks: {},
      unresolvedLinks: {},
    },
    workspace: {
      getActiveFile: () => null,
      getLastOpenFiles: () => [],
    },
  };
}

describe('requireMobileAgentVaultMutationPath', () => {
  const parityCases = [
    '.pivi/mcp.json', '.pivi/mcp.json.tmp-x', '.pivi/mcp.json.bak-x',
    '.pivi/mcp.json.corrupt-x', '.pivi/mcp-oauth/server/token.json',
    '.pivi/skills/demo/SKILL.md', '.pivi/skills-staging/x', '.pivi/skills-install-x',
    '.pivi/skills-list-x', '.pivi/skills-remove-x', '.pivi/skills-update-x',
    '.pivi/skills-update-all-x', '.pivi/skills-default-update-x',
    '.pivi/.skills-transaction-x', '.pivi/.skills-publication-x', '.pivi/.skills-backup-x',
    '.pivi/.agents/skills/demo/SKILL.md', '.pivi/.cursor/skills/demo/SKILL.md',
    '.pivi/skills-lock.json', '.pivi/.skills.json', 'skills-lock.json', '.skills.json',
    '.pivi/commands/x.md', '.pivi/templates/x.md', '.pivi/.commands-removal-x',
  ] as const;

  it.each(parityCases)('matches the desktop pure policy for direct path %s', (target) => {
    expect(() => assertAgentManagedPathMutationAllowed(target)).toThrow();
    expect(() => requireMobileAgentVaultMutationPath(target)).toThrow();
  });

  it.each(['.pivi', '.pivi/.agents', '.pivi/.cursor'])(
    'matches the desktop pure policy for recursive ancestor %s',
    (target) => {
      expect(() => assertAgentManagedPathMutationAllowed(target, { mode: 'recursive' })).toThrow();
      expect(() => requireMobileAgentVaultMutationPath(target, 'recursive')).toThrow();
    },
  );

  it.each(['.pivi/settings.json', '.pivi/sessions/a.jsonl', '.pivi/auth.json'])(
    'allows unrelated Pivi path %s in both policies',
    (target) => {
      expect(() => assertAgentManagedPathMutationAllowed(target)).not.toThrow();
      expect(requireMobileAgentVaultMutationPath(target)).toBe(target);
    },
  );

  it('rejects absolute, drive, UNC, traversal, NUL, and empty paths', () => {
    for (const raw of ['', '   ', '/abs.md', '//server/share/x.md', 'C:\\Users\\x.md', 'C:note.md',
      'notes/../escape.md', '../escape.md', 'notes/./x.md', 'notes//x.md', 'a\0b.md']) {
      expect(() => requireMobileAgentVaultMutationPath(raw)).toThrow();
    }
  });

  it('rejects managed direct, descendant, and temp/backup/corrupt siblings', () => {
    for (const raw of [
      '.pivi/mcp.json', '.pivi/mcp-oauth/token', '.pivi/skills/x', '.pivi/commands/c.md',
      '.pivi/templates/t.md', '.pivi/mcp.json.tmp-1', '.pivi/mcp.json.bak-2',
      '.pivi/mcp.json.corrupt-3', '.pivi/skills-install-abc',
    ]) {
      expect(() => requireMobileAgentVaultMutationPath(raw)).toThrow(/pivi_|reserved|managed/i);
    }
  });

  it('rejects recursive ancestors of managed roots while allowing unrelated .pivi paths', () => {
    expect(() => requireMobileAgentVaultMutationPath('.pivi', 'recursive')).toThrow(/pivi_mcp|managed/i);
    expect(() => requireMobileAgentVaultMutationPath('.pivi', 'direct')).not.toThrow();
    expect(requireMobileAgentVaultMutationPath('.pivi/settings.json')).toBe('.pivi/settings.json');
    expect(requireMobileAgentVaultMutationPath('notes/a.md')).toBe('notes/a.md');
  });
});

describe('MobileObsidianVaultApi', () => {
  it('returns immediately when a huge single note reaches the search limit', async () => {
    const content = Array.from({ length: 100_000 }, () => 'needle').join('\n');
    const app = makeApp([{ path: 'huge.md', content }]);
    const api = new MobileObsidianVaultApi(app as never);

    await expect(api.searchNotes({ query: 'needle', limit: 1 })).resolves.toEqual([
      { path: 'huge.md', line: 1 },
    ]);
  });

  it('writes, edits, moves, deletes, mkdirs, and attaches through public vault APIs', async () => {
    const app = makeApp([{ path: 'notes/a.md', content: 'hello world' }], ['notes']);
    const api = new MobileObsidianVaultApi(app as never);

    await expect(api.writeNote({ path: 'notes/b.md', content: 'new', mode: 'create' }))
      .resolves.toEqual({ path: 'notes/b.md' });
    await expect(api.editNote({
      path: 'notes/a.md', old_string: 'hello', new_string: 'hi',
    })).resolves.toEqual({ path: 'notes/a.md', replacements: 1 });
    await expect(api.movePath({ path: 'notes/b.md', newPath: 'notes/c.md' }))
      .resolves.toEqual({ path: 'notes/b.md', newPath: 'notes/c.md' });
    expect(app.moved).toEqual([{ path: 'notes/b.md', newPath: 'notes/c.md' }]);
    await expect(api.trashPath({ path: 'notes/a.md' }))
      .resolves.toEqual({ path: 'notes/a.md', kind: 'file' });
    expect(app.trashed).toEqual(['notes/a.md']);
    await expect(api.createFolder('archive')).resolves.toEqual({ path: 'archive' });
    expect(app.createdFolders).toEqual(['archive']);

    const info = await api.getAttachmentInfo({ filename: 'shot.png', sourcePath: 'notes/c.md' });
    expect(info.availablePath).toBe('assets/notes/c.md-shot.png');
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const written = await api.writeAttachment({
      filename: 'shot.png', data: bytes, sourcePath: 'notes/c.md',
    });
    expect(written.path).toBe('assets/notes/c.md-shot.png');
    expect(written.size).toBe(3);
    expect(app.binaries.get(written.path)?.byteLength).toBe(3);
    expect(api.recoveryCapability).toEqual({ available: false, reason: 'public-api-unavailable' });
  });

  it('enforces Mobile text and attachment byte budgets', async () => {
    const app = makeApp([{ path: 'n.md', content: 'x' }]);
    const api = new MobileObsidianVaultApi(app as never);
    const hugeText = 'a'.repeat(10_000_001);
    await expect(api.writeNote({ path: 'big.md', content: hugeText, mode: 'create' }))
      .rejects.toThrow(/10000000-byte/i);
    const hugeBinary = new ArrayBuffer(25_000_001);
    await expect(api.writeAttachment({ filename: 'big.bin', data: hugeBinary }))
      .rejects.toThrow(/25000000-byte/i);
  });

  it('blocks mutations that target managed paths', async () => {
    const app = makeApp([{ path: '.pivi/mcp.json', content: '{}' }], ['.pivi']);
    const api = new MobileObsidianVaultApi(app as never);
    await expect(api.writeNote({ path: '.pivi/mcp.json', content: '{}', mode: 'overwrite' }))
      .rejects.toThrow(/pivi_mcp|reserved|managed/i);
    await expect(api.createFolder('.pivi')).rejects.toThrow(/pivi_mcp|managed/i);
    await expect(api.trashPath({ path: '.pivi' })).rejects.toThrow(/pivi_mcp|managed/i);
  });
});
