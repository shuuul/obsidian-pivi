import { resolveExternalRootMentionAtIndex } from '@pivi/pivi-agent-core/context/mentions';

describe('resolveExternalRootMentionAtIndex', () => {
  const entries = [
    {
      contextRoot: '/Users/me/Docs',
      displayName: 'Docs',
      displayNameLower: 'docs',
    },
    {
      contextRoot: '/Users/me/Projects/Docs',
      displayName: 'Projects/Docs',
      displayNameLower: 'projects/docs',
    },
  ];

  it('resolves @Folder and @Folder/ roots', () => {
    expect(resolveExternalRootMentionAtIndex('@Docs please', 0, entries)).toEqual({
      resolvedPath: '/Users/me/Docs',
      endIndex: 5,
      trailingPunctuation: '',
    });
    expect(resolveExternalRootMentionAtIndex('@Docs/ please', 0, entries)).toEqual({
      resolvedPath: '/Users/me/Docs',
      endIndex: 6,
      trailingPunctuation: '',
    });
  });

  it('rejects nested external paths after the root slash', () => {
    expect(resolveExternalRootMentionAtIndex('@Docs/readme.md', 0, entries)).toBeNull();
  });

  it('prefers the longest matching display name', () => {
    expect(resolveExternalRootMentionAtIndex('@Projects/Docs/', 0, entries)).toEqual({
      resolvedPath: '/Users/me/Projects/Docs',
      endIndex: 15,
      trailingPunctuation: '',
    });
  });
});
