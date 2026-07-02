import { buildTurnSubmission, type TurnSubmissionSources } from '@/ui/chat/composer/ComposerSubmission';
import { createInlineContextToken } from '@/ui/shared/utils/inlineContext';

describe('buildTurnSubmission', () => {
  it('marks compact commands without file context transforms', () => {
    const sources = {
      selectionController: { getContext: () => null },
      canvasSelectionController: { getContext: () => null },
      getFileContextManager: () => ({
        getCurrentNotePath: () => 'notes/a.md',
        shouldSendCurrentNote: () => true,
        transformContextMentions: (text: string) => `transformed:${text}`,
        getAttachedFiles: () => new Set<string>(),
        collectContextFilePathsForTurn: () => undefined,
      }),
      getMcpServerSelector: () => null,
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: '/compact keep recent',
    });

    expect(result.turnRequest.text).toBe('/compact keep recent');
    expect(result.displayContent).toBe('/compact keep recent');
  });

  it('includes folder-expanded paths in attachedFilePaths', () => {
    const sources = {
      selectionController: { getContext: () => null },
      canvasSelectionController: { getContext: () => null },
      getFileContextManager: () => ({
        getCurrentNotePath: () => null,
        shouldSendCurrentNote: () => false,
        transformContextMentions: (text: string) => text,
        getAttachedFiles: () => new Set<string>(),
        collectContextFilePathsForTurn: () => ['notes/a.md', 'notes/sub/b.md'],
      }),
      getMcpServerSelector: () => null,
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: 'Review @notes/',
    });

    expect(result.turnRequest.attachedFilePaths).toEqual(['notes/a.md', 'notes/sub/b.md']);
    expect(result.displayContent).toBe('Review @notes/');
  });

  it('extracts inline context tokens into turn request context', () => {
    const sources = {
      selectionController: { getContext: () => null },
      canvasSelectionController: { getContext: () => null },
      getFileContextManager: () => ({
        getCurrentNotePath: () => null,
        shouldSendCurrentNote: () => false,
        transformContextMentions: (text: string) => text,
        getAttachedFiles: () => new Set<string>(),
        collectContextFilePathsForTurn: () => undefined,
      }),
      getMcpServerSelector: () => null,
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;
    const context = {
      type: 'editor-selection' as const,
      notePath: 'notes/example.md',
      noteName: 'example.md',
      selection: {
        from: { line: 1, ch: 2 },
        to: { line: 2, ch: 8 },
      },
      includedLines: { from: 2, to: 3 },
      text: 'xx<selection_start>selected\ntext<selection_end>',
    };
    const token = createInlineContextToken(context);

    const result = buildTurnSubmission(sources, {
      content: `Explain ${token}`,
    });

    expect(result.displayContent).toBe(`Explain ${token}`);
    expect(result.turnRequest.text).toBe('Explain');
    expect(result.turnRequest.inlineContexts).toEqual([context]);
  });
});
