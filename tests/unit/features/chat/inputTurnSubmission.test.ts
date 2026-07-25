import { buildTurnSubmission, type TurnSubmissionSources } from '@/ui/chat/composer/ComposerSubmission';
import { isSubmissionBlockedByContextLimit } from '@/ui/chat/composer/contextOverLimitNotice';
import { createInlineContextToken } from '@pivi/pivi-agent-core/context/inlineContext';
import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';

const overLimitUsage: UsageInfo = {
  contextTokens: 1_000,
  contextWindow: 1_000,
  inputTokens: 1_000,
  percentage: 100,
};

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
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: '/compact keep recent',
    });

    expect(result.turnRequest.text).toBe('/compact keep recent');
    expect(result.displayContent).toBe('/compact keep recent');
  });

  it('keeps compact available while blocking ordinary over-limit submissions', () => {
    expect(isSubmissionBlockedByContextLimit(overLimitUsage, 'continue')).toBe(true);
    expect(isSubmissionBlockedByContextLimit(overLimitUsage, '/compact')).toBe(false);
    expect(isSubmissionBlockedByContextLimit(overLimitUsage, '  /COMPACT keep decisions')).toBe(false);
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
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: 'Review @notes/',
    });

    expect(result.turnRequest.attachedFilePaths).toEqual(['notes/a.md', 'notes/sub/b.md']);
    expect(result.displayContent).toBe('Review @notes/');
  });

  it('keeps a command badge token visible while sending its resolved prompt text', () => {
    const sources = {
      selectionController: { getContext: () => null },
      canvasSelectionController: { getContext: () => null },
      getFileContextManager: () => null,
      getExternalContextSelector: () => null,
    } as unknown as TurnSubmissionSources;

    const result = buildTurnSubmission(sources, {
      content: '/review focus on naming',
      promptContent: 'Review this code. focus on naming',
    });

    expect(result.displayContent).toBe('/review focus on naming');
    expect(result.turnRequest.text).toBe('Review this code. focus on naming');
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
