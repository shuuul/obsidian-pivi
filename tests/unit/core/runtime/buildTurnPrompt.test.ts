import { buildTurnPrompt, finalizeTurnPrompt } from '../../../../src/core/runtime/buildTurnPrompt';
import type { ChatTurnRequest } from '../../../../src/core/runtime/types';

describe('buildTurnPrompt', () => {
  it('passes through compact commands without context tags', () => {
    const request: ChatTurnRequest = {
      text: '/compact keep recent',
      currentNotePath: 'notes/foo.md',
      editorSelection: {
        notePath: 'notes/foo.md',
        mode: 'selection',
        selectedText: 'selected',
      },
    };

    const built = buildTurnPrompt(request);
    expect(built.isCompact).toBe(true);
    expect(built.prompt).toBe('/compact keep recent');
  });

  it('appends current note, editor selection, and attached files', () => {
    const request: ChatTurnRequest = {
      text: '这个文件里有什么？',
      currentNotePath: 'notes/example.md',
      attachedFilePaths: ['notes/example.md', 'notes/other.md'],
      editorSelection: {
        notePath: 'notes/example.md',
        mode: 'selection',
        selectedText: 'hello world',
        startLine: 2,
        lineCount: 1,
      },
    };

    const built = buildTurnPrompt(request);
    expect(built.prompt).toContain('这个文件里有什么？');
    expect(built.prompt).toContain('<current_note>\nnotes/example.md\n</current_note>');
    expect(built.prompt).toContain('<editor_selection path="notes/example.md" lines="2-2">');
    expect(built.prompt).toContain('hello world');
    expect(built.prompt).toContain('<context_files>\nnotes/example.md, notes/other.md\n</context_files>');
    expect(built.persistedContent).toBe(built.prompt);
  });

  it('includes folder-expanded file paths in context_files', () => {
    const request: ChatTurnRequest = {
      text: 'Summarize @notes/',
      attachedFilePaths: ['notes/a.md', 'notes/sub/b.md'],
    };

    const built = buildTurnPrompt(request);
    expect(built.prompt).toContain('<context_files>\nnotes/a.md, notes/sub/b.md\n</context_files>');
  });
});

describe('finalizeTurnPrompt', () => {
  it('transforms MCP mentions for API prompt only', () => {
    const request: ChatTurnRequest = {
      text: 'Use @myserver for context',
    };
    const built = buildTurnPrompt(request);
    const mcpManager = {
      extractMentions: jest.fn(() => new Set(['myserver'])),
      transformMentions: jest.fn((text: string) => text.replace('@myserver', '@myserver MCP')),
    };

    const finalized = finalizeTurnPrompt(built, request, mcpManager);

    expect(finalized.persistedContent).toContain('@myserver');
    expect(finalized.prompt).toContain('@myserver MCP');
    expect(finalized.mcpMentions).toEqual(new Set(['myserver']));
  });
});
