import {
  canUseWikilinkAlias,
  formatVaultFileMentionToken,
  getPreferredAlias,
  normalizeAliases,
} from '@/ui/shared/mention/mentionTokenHelpers';

describe('mentionTokenHelpers', () => {
  it('normalizes aliases before display and insertion selection', () => {
    expect(normalizeAliases([' Deck ', '', 'Deck', 'Spec'])).toEqual(['Deck', 'Spec']);
    expect(getPreferredAlias(['Deck', 'Spec'], undefined)).toBe('Deck');
    expect(getPreferredAlias(['Deck', 'Spec'], 'Matched')).toBe('Matched');
  });

  it('formats safe aliased vault file mentions as wikilinks', () => {
    expect(formatVaultFileMentionToken('slides/Deck.md', 'Project deck')).toBe(
      '@[[slides/Deck.md|Project deck]]',
    );
  });

  it('falls back to raw @path when wikilink alias syntax would be ambiguous', () => {
    expect(canUseWikilinkAlias('slides/Deck.md', 'Project | deck')).toBe(true);
    expect(formatVaultFileMentionToken('slides/Deck|draft.md', 'Project deck')).toBe(
      '@slides/Deck|draft.md',
    );
    expect(formatVaultFileMentionToken('slides/Deck.md', 'Project ] deck')).toBe(
      '@slides/Deck.md',
    );
  });
});
