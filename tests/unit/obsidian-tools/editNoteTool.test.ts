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

  it('passes a local newline insertion through without requiring a whole line', async () => {
    const deps = makeDeps();
    const tool = createEditNoteTool(deps);

    await tool.execute('call', {
      path: 'notes/a.md',
      edits: [{ oldText: 'sentence.Second', newText: 'sentence.\n\nSecond' }],
    });

    expect(deps.vault.editNote).toHaveBeenCalledWith(expect.objectContaining({
      old_string: 'sentence.Second',
      new_string: 'sentence.\n\nSecond',
      replace_all: false,
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
      old_string: '>> Target',
      new_string: '\n\n### Heading',
      replace_all: false,
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
      old_string: '>>',
      new_string: newString,
      replace_all: true,
    });
  });
});
