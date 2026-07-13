import { TFile, TFolder } from 'obsidian';

import {
  getVaultFileAliases,
  parseWikilinkMentionAtIndex,
  resolveVaultWikilinkTarget,
} from '@pivi/obsidian-ui';

function makeFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFile(), {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
    stat: { ctime: 1, mtime: 1, size: 1 },
  });
}

function makeFolder(path: string): TFolder {
  return Object.assign(new TFolder(), {
    path,
    name: path.split('/').pop() ?? path,
  });
}

describe('contextMentionResolver', () => {
  it('parses wikilink mention tokens and rejects malformed tokens', () => {
    expect(parseWikilinkMentionAtIndex('@[[notes/A.md|Alias]] text', 0)).toEqual({
      raw: '@[[notes/A.md|Alias]]',
      linkPath: 'notes/A.md',
      alias: 'Alias',
      endIndex: 21,
    });
    expect(parseWikilinkMentionAtIndex('@[[notes/A.md]]', 0)).toEqual({
      raw: '@[[notes/A.md]]',
      linkPath: 'notes/A.md',
      alias: undefined,
      endIndex: 15,
    });
    expect(parseWikilinkMentionAtIndex('@[[|Alias]]', 0)).toBeNull();
    expect(parseWikilinkMentionAtIndex('@[[notes/A.md|Alias', 0)).toBeNull();
    expect(parseWikilinkMentionAtIndex('see @[[notes/A.md]]', 0)).toBeNull();
  });

  it('reads Obsidian frontmatter aliases through metadataCache', () => {
    const file = makeFile('notes/A.md');
    const app = {
      metadataCache: {
        getFileCache: jest.fn(() => ({
          frontmatter: { aliases: ['Alpha', 'A note'] },
        })),
      },
    };

    expect(getVaultFileAliases(app as never, file)).toEqual(['Alpha', 'A note']);
  });

  it('resolves wikilink targets by direct path, .md fallback, and linkpath fallback', () => {
    const direct = makeFile('notes/Direct.md');
    const implicitMarkdown = makeFile('notes/Implicit.md');
    const linked = makeFile('canonical/Target.md');
    const folder = makeFolder('notes');
    const getAbstractFileByPath = jest.fn((path: string) => {
      if (path === direct.path) return direct;
      if (path === implicitMarkdown.path) return implicitMarkdown;
      if (path === folder.path) return folder;
      return null;
    });
    const getFirstLinkpathDest = jest.fn(() => linked);
    const app = {
      vault: { getAbstractFileByPath },
      metadataCache: { getFirstLinkpathDest },
    };

    expect(resolveVaultWikilinkTarget(app as never, 'notes/Direct.md')).toBe(direct);
    expect(resolveVaultWikilinkTarget(app as never, 'notes/Implicit')).toBe(implicitMarkdown);
    expect(resolveVaultWikilinkTarget(app as never, 'notes')).toBe(folder);
    expect(resolveVaultWikilinkTarget(app as never, 'Alias target', 'source.md')).toBe(linked);
    expect(getFirstLinkpathDest).toHaveBeenCalledWith('Alias target', 'source.md');
  });
});
