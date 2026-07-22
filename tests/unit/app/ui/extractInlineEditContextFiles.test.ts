import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';

import { extractInlineEditContextFiles } from '@/app/ui/inlineEditSurface/extractInlineEditContextFiles';

function createContext(): MentionBadgeParseContext {
  return {
    vault: {
      getFiles: () => [
        { path: 'notes/alpha.md', basename: 'alpha.md' },
        { path: 'notes/beta.md', basename: 'beta.md' },
      ],
      getFolders: () => [{ path: 'notes', name: 'notes' }],
      getByPath: (path: string) => {
        if (path === 'notes/alpha.md') {
          return { kind: 'file', path, basename: 'alpha.md' };
        }
        if (path === 'notes') {
          return { kind: 'folder', path, name: 'notes' };
        }
        return null;
      },
      resolveWikilink: () => null,
      normalizeLookupKey: (value: string) => value,
    },
    mcpServerNames: new Set(),
    skillCommandNames: new Set(),
    externalContextEntries: [],
  };
}

describe('extractInlineEditContextFiles', () => {
  it('returns direct file mentions and expanded folder paths', () => {
    const paths = extractInlineEditContextFiles('Use @notes/alpha and @notes', createContext());
    expect(paths).toEqual(['notes/alpha.md', 'notes/beta.md']);
  });
});
