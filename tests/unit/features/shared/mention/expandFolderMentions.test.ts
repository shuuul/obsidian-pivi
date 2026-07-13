import {
  collectFolderMentionFilePaths,
  listVaultFilePathsUnderFolder,
  mergeContextFilePaths,
} from '@/ui/shared/mention/expandFolderMentions';
import type { MentionBadgeParseContext, MentionVaultLookup } from '@pivi/obsidian-ui';

function createVaultLookup(files: { path: string; basename: string }[]): MentionVaultLookup {
  const folders = [{ path: 'notes', name: 'notes' }];
  return {
    getFiles: () => files,
    getFolders: () => folders,
    getByPath(path) {
      const file = files.find((candidate) => candidate.path === path);
      if (file) return { kind: 'file', ...file };
      const folder = folders.find((candidate) => candidate.path === path);
      if (folder) return { kind: 'folder', ...folder };
      return null;
    },
    resolveWikilink(linkPath) {
      return this.getByPath(linkPath);
    },
  };
}

function createContext(files: { path: string; basename: string }[]): MentionBadgeParseContext {
  return {
    vault: createVaultLookup(files),
    mcpServerNames: new Set(),
  };
}

describe('expandFolderMentions', () => {
  const vaultFiles = [
    { path: 'notes/a.md', basename: 'a.md' },
    { path: 'notes/sub/b.md', basename: 'b.md' },
    { path: 'other/c.md', basename: 'c.md' },
  ];

  it('lists all vault files under a folder prefix', () => {
    const vault = createVaultLookup(vaultFiles);
    expect(listVaultFilePathsUnderFolder(vault, 'notes')).toEqual([
      'notes/a.md',
      'notes/sub/b.md',
    ]);
  });

  it('collects paths from @folder mentions in text', () => {
    const paths = collectFolderMentionFilePaths(
      'Review @notes/ and compare with @other/c.md',
      createContext(vaultFiles),
    );
    expect(paths).toEqual(['notes/a.md', 'notes/sub/b.md']);
  });

  it('skips absolute external folder mentions when expanding vault paths', () => {
    const paths = collectFolderMentionFilePaths(
      'Review @Docs/ and @notes/',
      {
        ...createContext(vaultFiles),
        externalContextEntries: [
          {
            contextRoot: '/Users/me/Docs',
            displayName: 'Docs',
            displayNameLower: 'docs',
          },
        ],
      },
    );
    expect(paths).toEqual(['notes/a.md', 'notes/sub/b.md']);
  });

  it('merges chip attachments with folder-expanded paths', () => {
    const merged = mergeContextFilePaths(
      new Set(['notes/a.md']),
      ['notes/sub/b.md', 'other/c.md'],
    );
    expect(merged).toEqual(['notes/a.md', 'notes/sub/b.md', 'other/c.md']);
  });
});
