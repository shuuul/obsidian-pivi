import {
  buildOldStringNotFoundMessage,
  replaceVaultEditMatch,
} from '@pivi/obsidian-host';

describe('vaultEditMatch', () => {
  it('replaces the single occurrence by default', () => {
    expect(replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'before old after',
      oldString: 'old',
      newString: 'new',
    })).toEqual({ content: 'before new after', replacements: 1 });
  });

  it('rejects zero occurrences with the established actionable error', () => {
    expect(() => replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'hello',
      oldString: 'missing',
      newString: 'new',
    })).toThrow('old_string not found in note.md');
  });

  it('rejects multiple occurrences without explicit replace_all', () => {
    expect(() => replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'old and old',
      oldString: 'old',
      newString: 'new',
    })).toThrow('old_string appears 2 times in note.md');
  });

  it('replaces every occurrence when replace_all is explicit', () => {
    expect(replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'old and old',
      oldString: 'old',
      newString: 'new',
      replaceAll: true,
    })).toEqual({ content: 'new and new', replacements: 2 });
  });

  it('rejects an invalid empty old_string', () => {
    expect(() => replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'hello',
      oldString: '',
      newString: 'new',
    })).toThrow('old_string must not be empty.');
  });

  it('allows an empty replacement and reports the occurrence count', () => {
    expect(replaceVaultEditMatch({
      filePath: 'note.md',
      content: 'remove me',
      oldString: 'remove ',
      newString: '',
    })).toEqual({ content: 'me', replacements: 1 });
  });

  it('retains straight-versus-curly quote diagnostics', () => {
    const message = buildOldStringNotFoundMessage(
      'note.md',
      '来自联系松散的“弱关系”。',
      '来自联系松散的"弱关系"。',
    );
    expect(message).toContain('curly quotes');
    expect(message).toContain('read');
  });
});
