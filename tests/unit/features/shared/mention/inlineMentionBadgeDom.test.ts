import { shouldSyncMentionBadgesOnInput } from '../../../../../src/features/shared/mention/inlineMentionBadgeDom';
import type { MentionBadgeParseContext } from '../../../../../src/features/shared/mention/mentionBadgeTypes';

function createContext(): MentionBadgeParseContext {
  return {
    app: {
      vault: {
        getAbstractFileByPath: () => null,
        getFiles: () => [],
      },
      workspace: { openLinkText: jest.fn() },
    } as unknown as MentionBadgeParseContext['app'],
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

  it('does not sync when badges already match parsed mentions', () => {
    const ctx = createContext();
    const text = '/exa hello';
    expect(
      shouldSyncMentionBadgesOnInput(editorWithBadgeCount(1), text, text.length, ctx),
    ).toBe(false);
  });
});
