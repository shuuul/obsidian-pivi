import {
  createContextBadgeViewModel,
  mentionPartToContextBadgeToken,
  parseContextBadges,
} from '@/ui/shared/context-badge';
import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';
import { createInlineContextToken } from '@/ui/shared/utils/inlineContext';

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
    skillCommandNames: new Set(['compact']),
  };
}

describe('ContextBadge model and parser', () => {
  it('maps existing mention parts to stable context badge tokens', () => {
    expect(mentionPartToContextBadgeToken({
      kind: 'mcp',
      raw: '/exa/search',
      serverName: 'exa',
      toolName: 'search',
    })).toEqual({
      kind: 'mcp',
      token: '/exa/search',
      serverName: 'exa',
      toolName: 'search',
    });

    expect(mentionPartToContextBadgeToken({
      kind: 'file',
      raw: '@notes/readme.md',
      path: 'notes/readme.md',
      label: 'readme',
    })).toEqual({
      kind: 'file',
      token: '@notes/readme.md',
      path: 'notes/readme.md',
      label: 'readme',
    });
  });

  it('derives shared labels, icon, tooltip, tone, and behavior flags', () => {
    expect(createContextBadgeViewModel({
      kind: 'skill',
      token: '/compact',
      commandName: 'compact',
    })).toMatchObject({
      label: 'compact',
      tooltip: 'Skill: compact',
      icon: { name: 'sparkles' },
      tone: 'tool',
      clickable: false,
      removable: false,
    });

    expect(createContextBadgeViewModel({
      kind: 'attachment',
      token: 'notes/readme.md',
      path: 'notes/readme.md',
    })).toMatchObject({
      label: 'readme.md',
      tooltip: 'notes/readme.md',
      icon: { name: 'file-text' },
      tone: 'attachment',
      clickable: true,
      removable: true,
    });
  });

  it('parses text into plain and ContextBadge parts without changing raw tokens', () => {
    const token = createInlineContextToken({
      type: 'editor-selection',
      notePath: 'notes/example.md',
      noteName: 'example.md',
      selection: {
        from: { line: 0, ch: 0 },
        to: { line: 0, ch: 4 },
      },
      includedLines: { from: 1, to: 1 },
      text: '<selection_start>test<selection_end>',
    });

    const parts = parseContextBadges(`Use /compact and /exa plus ${token}`, createContext());

    expect(parts.map((part) => part.kind)).toEqual(['plain', 'badge', 'plain', 'badge', 'plain', 'badge']);
    expect(parts.filter((part) => part.kind === 'badge').map((part) => part.token.token)).toEqual([
      '/compact',
      '/exa',
      token,
    ]);
  });
});
