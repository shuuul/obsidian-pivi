import { TFile } from 'obsidian';

import { TOOL_OBSIDIAN_EDIT, TOOL_OBSIDIAN_WRITE } from '../../../../src/pi/tools/obsidianToolNames';
import { ObsidianVaultApi } from '../../../../src/pi/tools/ObsidianVaultApi';
import { createResolveApprovalPattern } from '../../../../src/pi/tools/obsidian/resolveApprovalPattern';

function makeApp(files: Array<{ path: string }>) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (!byPath.has(path)) {
          return null;
        }
        const file = new TFile();
        Object.assign(file, { path, extension: 'md', basename: path.replace(/\.md$/, '') });
        return file;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => (byPath.has(`${link}.md`) ? { path: `${link}.md` } : null),
    },
    workspace: { getActiveFile: () => null },
  };
}

jest.mock('obsidian', () => jest.requireActual('../../../__mocks__/obsidian'));

describe('createResolveApprovalPattern', () => {
  const vaultPath = '/vault';

  it('normalizes path= to vault-relative slashes', () => {
    const api = new ObsidianVaultApi(makeApp([]) as never);
    const resolve = createResolveApprovalPattern(api, vaultPath);
    expect(resolve(TOOL_OBSIDIAN_WRITE, { path: 'notes/foo.md', content: '', mode: 'append' }))
      .toBe('notes/foo.md');
  });

  it('normalizes path= for obsidian_edit', () => {
    const api = new ObsidianVaultApi(makeApp([{ path: 'notes/foo.md' }]) as never);
    const resolve = createResolveApprovalPattern(api, vaultPath);
    expect(resolve(TOOL_OBSIDIAN_EDIT, {
      path: 'notes/foo.md',
      old_string: 'a',
      new_string: 'b',
    })).toBe('notes/foo.md');
  });

  it('resolves file= wikilink to vault path when note exists', () => {
    const api = new ObsidianVaultApi(makeApp([{ path: 'target.md' }]) as never);
    const resolve = createResolveApprovalPattern(api, vaultPath);
    expect(resolve(TOOL_OBSIDIAN_WRITE, { file: 'target', content: '', mode: 'append' }))
      .toBe('target.md');
  });

  it('falls back to getActionPattern for non-vault tools', () => {
    const api = new ObsidianVaultApi(makeApp([]) as never);
    const resolve = createResolveApprovalPattern(api, vaultPath);
    expect(resolve('obsidian_command', { id: 'app:reload' })).toBe('app:reload');
  });
});
