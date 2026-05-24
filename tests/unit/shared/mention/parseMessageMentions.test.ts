import { TFile, TFolder } from 'obsidian';

import type { MentionBadgeParseContext } from '../../../../src/shared/mention/mentionBadgeTypes';
import {
  messageTextHasMentionBadges,
  parseMessageMentions,
} from '../../../../src/shared/mention/parseMessageMentions';

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
      'Check @notes/readme.md and @notes/ plus @exa then /compact with @my-agent (agent)',
      createContext(),
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
});
