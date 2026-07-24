import { TFile } from 'obsidian';

import { buildVaultMentionItems } from '@/ui/shared/mention/mentionDropdownVaultItems';

function makeFile(path: string, mtime: number): TFile {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFile(), {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
    stat: { ctime: mtime, mtime, size: 1 },
  });
}

describe('buildVaultMentionItems', () => {
  it('matches files by frontmatter aliases and records the matched alias', () => {
    const deck = makeFile('slides/Quarterly Deck.md', 10);
    const other = makeFile('notes/Other.md', 20);

    const items = buildVaultMentionItems({
      searchLower: 'board',
      files: [deck, other],
      folders: [],
      getVaultFileAliases: file => file.path === deck.path ? [' Board deck ', 'Quarterly'] : [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'file',
      path: deck.path,
      aliases: ['Board deck', 'Quarterly'],
      matchedAlias: 'Board deck',
    });
  });

  it('prioritizes the active file when the query is empty', () => {
    const active = makeFile('notes/Active.md', 1);
    const newer = makeFile('notes/Newer.md', 100);

    const items = buildVaultMentionItems({
      searchLower: '',
      files: [newer, active],
      folders: [{ name: 'notes', path: 'notes' }],
      activeFilePath: active.path,
    });

    expect(items[0]).toMatchObject({ type: 'file', path: active.path });
  });

  it('hydrates aliases for displayed empty-query files without changing mtime ranking', () => {
    const first = makeFile('notes/First.md', 100);
    const second = makeFile('notes/Second.md', 50);

    const items = buildVaultMentionItems({
      searchLower: '',
      files: [second, first],
      folders: [],
      getVaultFileAliases: file => file.path === first.path ? ['First alias'] : ['Second alias'],
    });

    expect(items[0]).toMatchObject({
      type: 'file',
      path: first.path,
      aliases: ['First alias'],
    });
    expect(items[1]).toMatchObject({
      type: 'file',
      path: second.path,
      aliases: ['Second alias'],
    });
  });

  it('ranks a folder by path prefix so a nested-path query keeps it ahead of inclusion-only files', () => {
    // Folder wiki/ai (name "ai") gets its mtime from the file inside it.
    const inside = makeFile('wiki/ai/inside.md', 5);
    // Matches "wiki/ai" by inclusion only (path does NOT start with the query),
    // and has a much higher mtime so mtime cannot explain the ordering.
    const inclusionOnly = makeFile('notes/wiki/ai-summary.md', 1000);

    const items = buildVaultMentionItems({
      searchLower: 'wiki/ai',
      files: [inside, inclusionOnly],
      folders: [{ name: 'ai', path: 'wiki/ai' }],
    });

    const folderIndex = items.findIndex(i => i.type === 'folder' && i.path === 'wiki/ai');
    const inclusionIndex = items.findIndex(
      i => i.type === 'file' && i.path === 'notes/wiki/ai-summary.md',
    );

    expect(folderIndex).toBeGreaterThan(-1);
    expect(inclusionIndex).toBeGreaterThan(-1);
    // Path-prefix match (startsWithQuery) must outrank a mere inclusion match,
    // even when the inclusion-only file is far more recently modified.
    expect(folderIndex).toBeLessThan(inclusionIndex);
  });

  it('ranks an exact path match above files whose path only starts with the query', () => {
    // The folder wiki/ai is an exact path match for the query; the file inside it
    // only starts with the query. The folder must win even though the file is newer
    // and the type tiebreaker would otherwise put the file first.
    const inside = makeFile('wiki/ai/inside.md', 9000);

    const items = buildVaultMentionItems({
      searchLower: 'wiki/ai',
      files: [inside],
      folders: [{ name: 'ai', path: 'wiki/ai' }],
    });

    expect(items[0]).toMatchObject({ type: 'folder', path: 'wiki/ai' });
    expect(items[1]).toMatchObject({ type: 'file', path: 'wiki/ai/inside.md' });
  });

  it('ranks an exact folder-name path match above a same-named note for a short query', () => {
    // Typing the exact folder path "wiki" surfaces the wiki folder above wiki.md,
    // even though wiki.md is newer and the file-before-folder tiebreaker would
    // otherwise win.
    const note = makeFile('wiki.md', 9000);

    const items = buildVaultMentionItems({
      searchLower: 'wiki',
      files: [note],
      folders: [{ name: 'wiki', path: 'wiki' }],
    });

    expect(items[0]).toMatchObject({ type: 'folder', path: 'wiki' });
    expect(items[1]).toMatchObject({ type: 'file', path: 'wiki.md' });
  });
});
