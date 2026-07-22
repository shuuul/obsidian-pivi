import {
  createContextBadgeViewModel,
} from '@pivi/pivi-react/context-badges';
import { createI18n } from '@pivi/pivi-react';
import {
  mentionPartToContextBadgeToken,
} from '@/ui/shared/context-badge/ContextBadgeParser';

describe('ContextBadge model and parser', () => {
  const t = createI18n('en').t;

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
    }, t)).toMatchObject({
      label: 'compact',
      tooltip: 'Skill: compact',
      icon: { name: 'sparkles' },
      tone: 'tool',
      clickable: false,
      removable: false,
    });

    expect(createContextBadgeViewModel({
      kind: 'tool',
      token: '/generate-image',
      toolName: 'obsidian_generate_image',
    }, t)).toMatchObject({
      label: 'generate image',
      tooltip: 'Tool: obsidian_generate_image',
      icon: { name: 'image-plus' },
      tone: 'tool',
    });

    expect(createContextBadgeViewModel({
      kind: 'attachment',
      token: 'notes/readme.md',
      path: 'notes/readme.md',
    }, t)).toMatchObject({
      label: 'readme.md',
      tooltip: 'notes/readme.md',
      icon: { name: 'file-text' },
      tone: 'attachment',
      clickable: true,
      removable: true,
    });

    expect(createContextBadgeViewModel({
      kind: 'folder',
      token: '@Docs/',
      path: '/Users/me/Docs',
      label: 'Docs',
      source: 'external',
    }, t)).toMatchObject({
      label: 'Docs',
      icon: { name: 'database-search' },
    });

    expect(createContextBadgeViewModel({
      kind: 'inline-context',
      token: 'selection-token',
      context: {
        type: 'editor-selection',
        notePath: 'notes/readme.md',
        noteName: 'readme.md',
        selection: { from: { line: 1, ch: 2 }, to: { line: 1, ch: 8 } },
        includedLines: { from: 2, to: 2 },
        text: 'selected',
      },
    }, t)).toMatchObject({
      tone: 'inline',
      clickable: true,
      removable: true,
    });

    expect(createContextBadgeViewModel({
      kind: 'mcp',
      token: '/exa/search',
      serverName: 'exa',
      toolName: 'search',
    }, t)).toMatchObject({
      label: 'search',
      tooltip: 'MCP tool: exa/search',
    });
  });

  it('localizes technical tooltip prefixes while preserving identifiers', () => {
    const zhT = createI18n('zh-CN').t;
    expect(createContextBadgeViewModel({
      kind: 'tool',
      token: '/generate-image',
      toolName: 'obsidian_generate_image',
    }, zhT).tooltip).toBe('工具：obsidian_generate_image');
  });
});
