import { createEditNoteTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      editNote: jest.fn().mockResolvedValue({ path: 'notes/a.md', replacements: 3 }),
    },
  } as never;
}

describe('createEditNoteTool', () => {
  it('teaches exact local-substring newline insertion and Markdown boundaries', () => {
    const tool = createEditNoteTool(makeDeps());

    expect(tool.label).toBe('Replace text');
    expect(tool.promptUsage?.summary).toContain('does not need to contain a whole physical line');
    expect(tool.promptUsage?.summary).toContain('shortest exact span that is unique');
    expect(tool.promptUsage?.summary).toContain('oldText=`sentence.Second`');
    expect(tool.promptUsage?.summary).toContain('newText=`sentence.\\n\\nSecond`');
    expect(tool.promptUsage?.summary).toContain('do not send the surrounding multi-thousand-character line');
    expect(tool.promptUsage?.summary).toContain('oldText=`>>`');
    expect(tool.promptUsage?.summary).toContain('newText=`\\n\\n`');
    expect(tool.promptUsage?.summary).toContain('newText=`\\n\\n>>`');
    expect(tool.promptUsage?.summary).toContain('Replacement is literal');
    expect(tool.promptUsage?.summary).toContain('block Markdown such as headings, lists, blockquotes/callouts');
    expect(tool.promptUsage?.summary).toContain('replacing only `Target` with `### Heading`');
    expect(tool.promptUsage?.summary).toContain('produces `>> ### Heading`, not a heading');
    expect(tool.promptUsage?.summary).toContain('Include the delimiter in oldText');
    expect(tool.promptUsage?.summary).toContain('receive the identical replacement');
  });

  it('rejects oversized oldText or newText before vault access', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await expect(tool.execute('call', {
      path: 'notes/a.md',
      edits: [{ oldText: 'x'.repeat(50_001), newText: 'ok' }],
    })).rejects.toThrow('at most 50000 characters');
    expect(deps.vault.editNote).not.toHaveBeenCalled();
  });

  it('passes a local newline insertion through without requiring a whole line', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      edits: [{ oldText: 'sentence.Second', newText: 'sentence.\n\nSecond' }],
    });

    expect(deps.vault.editNote).toHaveBeenCalledWith(expect.objectContaining({
      edits: [{ oldText: 'sentence.Second', newText: 'sentence.\n\nSecond', replaceAll: false }],
    }));
  });

  it('passes a self-contained Markdown heading replacement through unchanged', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      edits: [{ oldText: '>> Target', newText: '\n\n### Heading' }],
    });

    expect(deps.vault.editNote).toHaveBeenCalledWith(expect.objectContaining({
      edits: [{ oldText: '>> Target', newText: '\n\n### Heading', replaceAll: false }],
    }));
  });

  it.each([
    ['removes delimiters', '\n\n'],
    ['retains delimiters at the next block', '\n\n>>'],
  ])('%s with explicit multi-occurrence replacement', async (_label, newString) => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      edits: [{ oldText: '>>', newText: newString, replaceAll: true }],
    });

    expect(deps.vault.editNote).toHaveBeenCalledWith({
      file: undefined,
      path: 'notes/a.md',
      edits: [{ oldText: '>>', newText: newString, replaceAll: true }],
    });
  });

  it('passes every edits[] item through instead of only the first', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      edits: [
        { oldText: 'alpha', newText: 'one' },
        { oldText: 'beta', newText: 'two', replaceAll: true },
      ],
    });

    expect(deps.vault.editNote).toHaveBeenCalledWith({
      file: undefined,
      path: 'notes/a.md',
      edits: [
        { oldText: 'alpha', newText: 'one', replaceAll: false },
        { oldText: 'beta', newText: 'two', replaceAll: true },
      ],
    });
  });
});
