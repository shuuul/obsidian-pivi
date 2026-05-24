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
      }),
      getMcpServerSelector: () => null,
      getExternalContextSelector: () => null,
    } as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: '/compact keep recent',
    });

    expect(result.turnRequest.text).toBe('/compact keep recent');
    expect(result.displayContent).toBe('/compact keep recent');
  });
});
