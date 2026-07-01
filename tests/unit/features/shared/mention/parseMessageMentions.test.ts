import { TFile, TFolder } from 'obsidian';

import type { MentionBadgeParseContext } from '../../../../../src/features/shared/mention/mentionBadgeTypes';
import {
  messageTextHasMentionBadges,
  parseMessageMentions,
} from '../../../../../src/features/shared/mention/parseMessageMentions';
import { createInlineContextToken } from '../../../../../src/utils/inlineContext';

function createContext(overrides: Partial<MentionBadgeParseContext> = {}): MentionBadgeParseContext {
  const file = Object.assign(new TFile(), {
    path: 'notes/readme.md',
    basename: 'readme.md',
    extension: 'md',
  });
  const folder = Object.assign(new TFolder(), {
    path: 'notes',
    name: 'notes',
  });

  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => {
          if (path === 'notes/readme.md') return file;
          if (path === 'notes') return folder;
          return null;
        },
        getFiles: () => [file],
      },
      workspace: { openLinkText: jest.fn() },
    } as unknown as MentionBadgeParseContext['app'],
    mcpServerNames: new Set(['exa']),
    ...overrides,
  };
}

describe('parseMessageMentions', () => {
  it('detects mention-like text', () => {
    expect(messageTextHasMentionBadges('hello @notes/readme.md')).toBe(true);
    expect(messageTextHasMentionBadges('/compact')).toBe(true);
    expect(messageTextHasMentionBadges('plain text')).toBe(false);
  });

  it('parses vault file, folder, mcp, slash, and agent mentions', () => {
    const parts = parseMessageMentions(
      'Check @notes/readme.md and @notes/ plus /exa then /compact with @my-agent (agent)',
      createContext({ skillCommandNames: new Set(['compact']) }),
    );

    expect(parts.map((part) => part.kind)).toEqual([
      'plain',
      'file',
      'plain',
      'folder',
      'plain',
      'mcp',
      'plain',
      'skill',
      'plain',
      'agent',
    ]);
  });

  it('keeps unknown @ tokens as plain text', () => {
    const parts = parseMessageMentions('see @unknown.md here', createContext());
    expect(parts).toEqual([
      { kind: 'plain', text: 'see @unknown.md here' },
    ]);
  });

  it('labels inline context badges with file, exact range, and preview', () => {
    const token = createInlineContextToken({
      type: 'editor-selection',
      notePath: 'notes/example.md',
      noteName: 'example.md',
      selection: {
        from: { line: 1, ch: 2 },
        to: { line: 2, ch: 8 },
      },
      includedLines: { from: 2, to: 3 },
      text: 'xx<selection_start>selected\ntext<selection_end>',
    });

    const parts = parseMessageMentions(token, createContext());

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: 'inline-context',
      label: 'example.md 2:3–3:9 · xxselected text',
    });
  });
});
