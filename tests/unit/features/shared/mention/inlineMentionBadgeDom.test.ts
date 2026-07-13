import { shouldSyncMentionBadgesOnInput } from '@/ui/shared/mention/inlineMentionBadgeDom';
import type { MentionBadgeParseContext } from '@pivi/obsidian-ui';

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
