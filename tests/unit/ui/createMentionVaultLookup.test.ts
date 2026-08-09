import { Platform } from 'obsidian';

import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';

describe('createMentionVaultLookup', () => {
  const app = {
    vault: {
      getFiles: () => [],
      getAllLoadedFiles: () => [],
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
    },
  } as unknown as import('obsidian').App;

  afterEach(() => {
    (Platform as { isWin: boolean }).isWin = false;
  });

  it('case-folds lookup keys on Windows hosts via Platform.isWin', () => {
    (Platform as { isWin: boolean }).isWin = true;
    const lookup = createMentionVaultLookup(app);
    expect(lookup.normalizeLookupKey?.('Notes/ABC.md')).toBe('notes/abc.md');
  });

  it('preserves lookup key case on non-Windows hosts', () => {
    (Platform as { isWin: boolean }).isWin = false;
    const lookup = createMentionVaultLookup(app);
    expect(lookup.normalizeLookupKey?.('Notes/ABC.md')).toBe('Notes/ABC.md');
  });
});
