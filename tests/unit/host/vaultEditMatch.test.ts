import {
  applyVaultEdits,
  buildOldStringNotFoundMessage,
} from '@pivi/obsidian-host';

/** Single-edit form of `applyVaultEdits`, the policy `ObsidianVaultApi.editNote` applies. */
function replaceVaultEditMatch(params: {
  filePath: string;
  content: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}) {
  return applyVaultEdits({
    filePath: params.filePath,
    content: params.content,
    edits: [{ oldText: params.oldString, newText: params.newString, replaceAll: params.replaceAll }],
  });
}

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

describe('applyVaultEdits', () => {
  it('applies every item against the original file', () => {
    expect(applyVaultEdits({
      filePath: 'note.md',
      content: 'alpha beta',
      edits: [
        { oldText: 'alpha', newText: 'one' },
        { oldText: 'beta', newText: 'two' },
      ],
    })).toEqual({ content: 'one two', replacements: 2 });
  });

  it('rejects overlapping spans instead of applying incrementally', () => {
    expect(() => applyVaultEdits({
      filePath: 'note.md',
      content: 'hello world',
      edits: [
        { oldText: 'hello world', newText: 'x' },
        { oldText: 'world', newText: 'y' },
      ],
    })).toThrow('edits[0] and edits[1] overlap in note.md');
  });

  it('keeps replaceAll on the original text', () => {
    expect(applyVaultEdits({
      filePath: 'note.md',
      content: 'foo bar foo',
      edits: [{ oldText: 'foo', newText: 'baz', replaceAll: true }],
    })).toEqual({ content: 'baz bar baz', replacements: 2 });
  });
});
