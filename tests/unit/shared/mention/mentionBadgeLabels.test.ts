import {
  formatMcpBadgeLabel,
  formatSkillBadgeLabel,
} from '../../../../src/shared/mention/mentionBadgeLabels';

describe('mentionBadgeLabels', () => {
  it('formats skill labels without a leading slash', () => {
    expect(formatSkillBadgeLabel('obsidian-markdown')).toBe('obsidian-markdown');
    expect(formatSkillBadgeLabel('/obsidian-markdown')).toBe('obsidian-markdown');
  });

  it('formats MCP labels without a leading slash', () => {
    expect(formatMcpBadgeLabel('exa')).toBe('exa');
    expect(formatMcpBadgeLabel('exa', 'search')).toBe('exa/search');
  });
});
