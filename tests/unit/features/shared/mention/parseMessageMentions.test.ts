import { TFile, TFolder } from 'obsidian';

import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';
import {
  messageTextHasMentionBadges,
  parseMessageMentions,
} from '@/ui/shared/mention/parseMessageMentions';
import { createInlineContextToken } from '@pivi/pivi-agent-core/context/inlineContext';

function createContext(overrides: Partial<MentionBadgeParseContext> = {}): MentionBadgeParseContext {
  const file = Object.assign(new TFile(), {
    path: 'notes/readme.md',
    basename: 'readme.md',
    extension: 'md',
  });
  const spacedFile = Object.assign(new TFile(), {
    path: 'slides/examples/Marp Example.md',
    basename: 'Marp Example',
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
          if (path === 'slides/examples/Marp Example.md') return spacedFile;
          if (path === 'notes') return folder;
          return null;
        },
        getFiles: () => [file, spacedFile],
        getAllLoadedFiles: () => [file, spacedFile, folder],
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

  it('parses slash commands when no skill names are loaded yet', () => {
    const parts = parseMessageMentions(
      '/generate-image a cat',
      createContext({ skillCommandNames: new Set() }),
    );

    expect(parts).toEqual([
      { kind: 'skill', raw: '/generate-image', commandName: 'generate-image' },
      { kind: 'plain', text: ' a cat' },
    ]);
  });

  it('keeps absolute filesystem paths as plain text instead of slash command badges', () => {
    const path = '/Users/shuuul/Projects/pivi/zed';
    expect(parseMessageMentions(path, createContext())).toEqual([
      { kind: 'plain', text: path },
    ]);
    expect(parseMessageMentions(`Open ${path} please`, createContext())).toEqual([
      { kind: 'plain', text: `Open ${path} please` },
    ]);
  });

  it('still parses slash MCP tool mentions with path-like slash syntax', () => {
    const parts = parseMessageMentions('/exa/search query', createContext());

    expect(parts).toEqual([
      { kind: 'mcp', raw: '/exa/search', serverName: 'exa', toolName: 'search' },
      { kind: 'plain', text: ' query' },
    ]);
  });

  it('parses vault file mentions whose path contains spaces', () => {
    const parts = parseMessageMentions(
      'Use @slides/examples/Marp Example.md please',
      createContext(),
    );

    expect(parts).toEqual([
      { kind: 'plain', text: 'Use ' },
      {
        kind: 'file',
        raw: '@slides/examples/Marp Example.md',
        path: 'slides/examples/Marp Example.md',
        label: 'Marp Example',
      },
      { kind: 'plain', text: ' please' },
    ]);
  });

  it('parses aliased vault file mentions using wikilink pipe syntax', () => {
    const parts = parseMessageMentions(
      'Use @[[slides/examples/Marp Example.md|Deck alias]] please',
      createContext(),
    );

    expect(parts).toEqual([
      { kind: 'plain', text: 'Use ' },
      {
        kind: 'file',
        raw: '@[[slides/examples/Marp Example.md|Deck alias]]',
        path: 'slides/examples/Marp Example.md',
        label: 'Deck alias',
      },
      { kind: 'plain', text: ' please' },
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
