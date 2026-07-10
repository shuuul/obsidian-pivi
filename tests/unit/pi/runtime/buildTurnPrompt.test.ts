import {
  appendExternalContextAvailability,
  buildTurnPrompt,
  finalizeTurnPrompt,
} from '@pivi/pivi-agent-core/prompt';
import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';

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
    expect(built.persistedContent).not.toContain('<subagent_delegation_policy>');
  });

  it('appends inline_contexts for explicit editor selections', () => {
    const request: ChatTurnRequest = {
      text: 'Explain this selection',
      inlineContexts: [{
        type: 'editor-selection',
        notePath: 'notes/example.md',
        noteName: 'example.md',
        selection: {
          from: { line: 11, ch: 8 },
          to: { line: 13, ch: 20 },
        },
        includedLines: { from: 12, to: 14 },
        text: 'marked <selection_start>body<selection_end>',
      }],
    };

    const built = buildTurnPrompt(request);
    expect(built.prompt).toContain('Explain this selection');
    expect(built.prompt).toContain('<inline_contexts>');
    expect(built.prompt).toContain('path="notes/example.md"');
    expect(built.prompt).toContain('<selection_start>body<selection_end>');
  });

  it('includes folder-expanded file paths in context_files', () => {
    const request: ChatTurnRequest = {
      text: 'Summarize @notes/',
      attachedFilePaths: ['notes/a.md', 'notes/sub/b.md'],
    };

    const built = buildTurnPrompt(request);
    expect(built.prompt).toContain('<context_files>\nnotes/a.md, notes/sub/b.md\n</context_files>');
  });

  it('does not inject turn-local subagent guidance for multi-context tasks', () => {
    const request: ChatTurnRequest = {
      text: 'Compare these notes and extract common themes',
      attachedFilePaths: ['notes/a.md', 'notes/b.md'],
    };

    const built = buildTurnPrompt(request);

    expect(built.prompt).toContain('<context_files>');
    expect(built.prompt).not.toContain('<subagent_delegation_policy>');
    expect(built.persistedContent).not.toContain('<subagent_delegation_policy>');
  });

  it('does not add automatic subagent guidance for a single attached file', () => {
    const request: ChatTurnRequest = {
      text: 'Summarize this note',
      attachedFilePaths: ['notes/a.md'],
    };

    const built = buildTurnPrompt(request);

    expect(built.prompt).not.toContain('<subagent_delegation_policy>');
  });

  it('keeps explicit subagent requests in user text without injecting policy tags', () => {
    const request: ChatTurnRequest = {
      text: 'Use subagent to read three cards',
      attachedFilePaths: ['cards/a.md', 'cards/b.md'],
    };

    const built = buildTurnPrompt(request);

    expect(built.prompt).toContain('Use subagent to read three cards');
    expect(built.prompt).toContain('<context_files>');
    expect(built.prompt).not.toContain('<subagent_delegation_policy>');
    expect(built.persistedContent).not.toContain('<subagent_delegation_policy>');
  });

  it('appends current external context availability to the API prompt only', () => {
    const built = buildTurnPrompt({
      text: 'Read the external project',
      externalContextPaths: ['/available', '/missing'],
    });

    const prompt = appendExternalContextAvailability(built.prompt, [
      { path: '/available', available: true },
      { path: '/missing', available: false, reason: 'not-found' },
    ]);

    expect(prompt).toContain('<external_contexts>');
    expect(prompt).toContain('<context path="/available" available="true" />');
    expect(prompt).toContain('<context path="/missing" available="false" reason="not-found" />');
    expect(built.persistedContent).toBe('Read the external project');
    expect(built.persistedContent).not.toContain('<external_contexts>');
  });

  it('escapes external context values in availability XML', () => {
    const prompt = appendExternalContextAvailability('Inspect', [
      { path: '/tmp/a&b"c', available: false, reason: 'missing <directory>' },
    ]);

    expect(prompt).toContain('path="/tmp/a&amp;b&quot;c"');
    expect(prompt).toContain('reason="missing &lt;directory&gt;"');
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

  it('transforms MCP mentions while preserving attached context files', () => {
    const request: ChatTurnRequest = {
      text: 'Use @myserver and compare these notes with subagents',
      attachedFilePaths: ['notes/a.md', 'notes/b.md'],
    };
    const built = buildTurnPrompt(request);
    const mcpManager = {
      extractMentions: jest.fn(() => new Set(['myserver'])),
      transformMentions: jest.fn((text: string) => text.replace('@myserver', '@myserver MCP')),
    };

    const finalized = finalizeTurnPrompt(built, request, mcpManager);

    expect(finalized.prompt).toContain('@myserver MCP');
    expect(finalized.prompt).toContain('<context_files>');
    expect(finalized.persistedContent).toContain('@myserver');
    expect(finalized.persistedContent).not.toContain('<subagent_delegation_policy>');
  });
});
