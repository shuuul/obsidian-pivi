import { shouldSyncMentionBadgesOnInput } from '@/ui/shared/mention/inlineMentionBadgeDom';
import { revealInlineContext } from '@/ui/shared/mention/inlineContextNavigation';
import type { MentionBadgeParseContext, MentionVaultLookup } from '@pivi/pivi-agent-core/context/mentions';

const flashSelectionHighlight = jest.fn();

jest.mock('@/ui/shared/components/SelectionHighlight', () => ({
  flashSelectionHighlight: (...args: unknown[]) => flashSelectionHighlight(...args),
}));

function emptyVault(): MentionVaultLookup {
  return {
    getFiles: () => [],
    getFolders: () => [],
    getByPath: () => null,
    resolveWikilink: () => null,
  };
}

function createContext(): MentionBadgeParseContext {
  return {
    vault: emptyVault(),
    mcpServerNames: new Set(['exa']),
  };
}

function editorWithBadgeCount(badgeCount: number): HTMLElement {
  const badges = Array.from({ length: badgeCount }, () => ({ dataset: { mentionToken: '/exa' } }));
  return {
    querySelectorAll: (selector: string) =>
      selector.includes('mention-token') ? badges : [],
  } as unknown as HTMLElement;
}

describe('shouldSyncMentionBadgesOnInput', () => {
  it('does not sync while mention token is still being typed', () => {
    const ctx = createContext();
    const text = 'see /exa';
    expect(
      shouldSyncMentionBadgesOnInput(editorWithBadgeCount(0), text, text.length, ctx),
    ).toBe(false);
  });

  it('syncs after whitespace completes a mention token', () => {
    const ctx = createContext();
    const text = 'see /exa ';
    expect(
      shouldSyncMentionBadgesOnInput(editorWithBadgeCount(0), text, text.length, ctx),
    ).toBe(true);
  });

  it('does not sync absolute filesystem paths into slash command badges', () => {
    const ctx = createContext();
    const text = '/Users/shuuul/Projects/pivi/zed ';
    expect(
      shouldSyncMentionBadgesOnInput(editorWithBadgeCount(0), text, text.length, ctx),
    ).toBe(false);
  });

  it('does not sync when badges already match parsed mentions', () => {
    const ctx = createContext();
    const text = '/exa hello';
    expect(
      shouldSyncMentionBadgesOnInput(editorWithBadgeCount(1), text, text.length, ctx),
    ).toBe(false);
  });
});

describe('revealInlineContext', () => {
  beforeEach(() => flashSelectionHighlight.mockClear());

  it('opens, selects, centers, focuses, and flashes the captured editor range', async () => {
    const editorView = {};
    const editor = {
      lastLine: () => 4,
      getLine: () => '0123456789',
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      posToOffset: ({ line, ch }: { line: number; ch: number }) => line * 100 + ch,
      cm: editorView,
    };
    const view = { file: { path: 'notes/readme.md' }, editor };
    const app = {
      workspace: {
        openLinkText: jest.fn().mockResolvedValue(undefined),
        getActiveViewOfType: jest.fn().mockReturnValue(view),
      },
    };
    const context = {
      type: 'editor-selection' as const,
      notePath: 'notes/readme.md',
      noteName: 'readme.md',
      selection: { from: { line: 1, ch: 2 }, to: { line: 3, ch: 7 } },
      includedLines: { from: 2, to: 4 },
      text: 'selected',
    };

    await revealInlineContext(app as never, context);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('notes/readme.md', '');
    expect(editor.setSelection).toHaveBeenCalledWith(
      { line: 1, ch: 2 },
      { line: 3, ch: 7 },
    );
    expect(editor.scrollIntoView).toHaveBeenCalledWith({
      from: { line: 1, ch: 2 },
      to: { line: 3, ch: 7 },
    }, true);
    expect(editor.focus).toHaveBeenCalled();
    expect(flashSelectionHighlight).toHaveBeenCalledWith(editorView, 102, 307);
  });

  it('clamps stale positions to the current editor document', async () => {
    const editor = {
      lastLine: () => 1,
      getLine: (line: number) => line === 0 ? 'first' : 'last',
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
    };
    const app = {
      workspace: {
        openLinkText: jest.fn().mockResolvedValue(undefined),
        getActiveViewOfType: jest.fn().mockReturnValue({
          file: { path: 'notes/readme.md' },
          editor,
        }),
      },
    };

    await revealInlineContext(app as never, {
      type: 'editor-selection',
      notePath: 'notes/readme.md',
      noteName: 'readme.md',
      selection: { from: { line: -3, ch: -2 }, to: { line: 99, ch: 99 } },
      includedLines: { from: 1, to: 100 },
      text: 'stale',
    });

    expect(editor.setSelection).toHaveBeenCalledWith(
      { line: 0, ch: 0 },
      { line: 1, ch: 4 },
    );
  });
});
