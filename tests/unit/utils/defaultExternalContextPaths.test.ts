import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

describe('getDefaultExternalContextPaths', () => {
  it('returns settings externalReadDirectories', () => {
    const paths = getDefaultExternalContextPaths({
      agentSettings: {
        obsidianTools: {
          allowExternalRead: true,
          externalReadDirectories: ['/tmp/a', '/tmp/b'],
        },
      },
    });

    expect(paths).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('keeps unavailable pinned directories for per-turn availability checks', () => {
    const paths = getDefaultExternalContextPaths({
      agentSettings: {
        obsidianTools: {
          allowExternalRead: true,
          externalReadDirectories: ['/tmp/a', '/missing'],
        },
      },
    });

    expect(paths).toEqual(['/tmp/a', '/missing']);
  });
});
