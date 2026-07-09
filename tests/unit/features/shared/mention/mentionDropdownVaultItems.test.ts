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
});
