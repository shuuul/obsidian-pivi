import { TFile, TFolder } from 'obsidian';

import {
  collectFolderMentionFilePaths,
  listVaultFilePathsUnderFolder,
  mergeContextFilePaths,
} from '@/ui/shared/mention/expandFolderMentions';
import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';

function createVaultApp(files: { path: string; basename: string }[]): MentionBadgeParseContext['app'] {
  const tFiles = files.map((file) => Object.assign(new TFile(), file));
  const notesFolder = Object.assign(new TFolder(), { path: 'notes', name: 'notes' });

  return {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (path === 'notes') return notesFolder;
        return tFiles.find((file) => file.path === path) ?? null;
      },
      getFiles: () => tFiles,
    },
    workspace: { openLinkText: jest.fn() },
  } as unknown as MentionBadgeParseContext['app'];
}

function createContext(files: { path: string; basename: string }[]): MentionBadgeParseContext {
  return {
    app: createVaultApp(files),
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
    const app = createVaultApp(vaultFiles);
    expect(listVaultFilePathsUnderFolder(app, 'notes')).toEqual([
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

  it('merges chip attachments with folder-expanded paths', () => {
    const merged = mergeContextFilePaths(
      new Set(['notes/a.md']),
      ['notes/sub/b.md', 'other/c.md'],
    );
    expect(merged).toEqual(['notes/a.md', 'notes/sub/b.md', 'other/c.md']);
  });
});
