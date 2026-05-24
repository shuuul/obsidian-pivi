import { buildTurnSubmission, type TurnSubmissionSources } from '../../../../src/features/chat/controllers/inputTurnSubmission';

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
});
