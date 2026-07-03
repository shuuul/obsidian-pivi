import {
  formatInlineContextBadgeLabel,
  formatInlineContextPreview,
  formatInlineContextTooltip,
  formatRemoveInlineContextAriaLabel,
  formatMcpBadgeLabel,
  formatSkillBadgeLabel,
} from '@/ui/shared/mention/mentionBadgeLabels';
import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

describe('mentionBadgeLabels', () => {
  it('formats skill labels without a leading slash', () => {
    expect(formatSkillBadgeLabel('obsidian-markdown')).toBe('obsidian-markdown');
    expect(formatSkillBadgeLabel('/obsidian-markdown')).toBe('obsidian-markdown');
  });

  it('formats MCP labels without a leading slash', () => {
    expect(formatMcpBadgeLabel('exa')).toBe('exa');
    expect(formatMcpBadgeLabel('exa', 'search')).toBe('exa/search');
  });

  it('formats inline context labels, tooltips, previews, and remove labels', () => {
    const context: InlineContextReference = {
      type: 'editor-selection',
      notePath: 'notes/project/example.md',
      noteName: 'example.md',
      selection: {
        from: { line: 1, ch: 2 },
        to: { line: 2, ch: 8 },
      },
      includedLines: { from: 2, to: 3 },
      text: 'xx<selection_start>selected\ntext for a longer preview<selection_end>',
    };

    expect(formatInlineContextPreview(context, 18)).toBe('xxselected text f…');
    expect(formatInlineContextBadgeLabel(context)).toBe('example.md 2:3–3:9 · xxselected text for a longer preview');
    expect(formatInlineContextTooltip(context)).toContain('Inline context from notes/project/example.md');
    expect(formatInlineContextTooltip(context)).toContain('Selection: 2:3–3:9');
    expect(formatInlineContextTooltip(context)).toContain('Preview: xxselected text for a longer preview');
    expect(formatRemoveInlineContextAriaLabel(context)).toBe('Remove inline context from example.md 2:3–3:9');
  });
});
