import { DEFAULT_OBSIDIAN_TOOLS_SETTINGS } from '@pivi/pivi-agent-core/foundation';
import { createMobileVaultTools } from '@pivi/obsidian-tools/mobile';

import { MOBILE_VAULT_TOOLS } from '@/app/composition/mobile/capabilityProjection';

type VaultToolApi = Parameters<typeof createMobileVaultTools>[0]['vault'];

const MUTATIONS = [
  'obsidian_write',
  'obsidian_edit',
  'obsidian_move',
  'obsidian_delete',
  'obsidian_mkdir',
  'obsidian_attachment',
] as const;

const READS = MOBILE_VAULT_TOOLS.filter(
  (name): name is Exclude<(typeof MOBILE_VAULT_TOOLS)[number], (typeof MUTATIONS)[number]> => (
    !(MUTATIONS as readonly string[]).includes(name)
  ),
);

function mutationParams(name: string): Record<string, unknown> {
  switch (name) {
    case 'obsidian_write':
      return { path: 'n.md', content: 'x', mode: 'create' };
    case 'obsidian_edit':
      return { path: 'n.md', old_string: 'a', new_string: 'b' };
    case 'obsidian_move':
      return { path: 'a.md', newPath: 'b.md' };
    case 'obsidian_delete':
      return { path: 'a.md' };
    case 'obsidian_mkdir':
      return { path: 'folder' };
    case 'obsidian_attachment':
      return { path: 'a.png' };
    default:
      return {};
  }
}

function readParams(name: string): Record<string, unknown> {
  switch (name) {
    case 'obsidian_read':
    case 'obsidian_markdown_structure':
    case 'obsidian_note_info':
    case 'obsidian_links':
    case 'obsidian_properties':
      return { path: 'n.md', action: name === 'obsidian_properties' ? 'read' : undefined, name: 'title' };
    case 'obsidian_search':
      return { query: 'hello' };
    case 'obsidian_list':
      return { path: '' };
    case 'obsidian_tags':
      return { action: 'list' };
    case 'obsidian_graph':
      return { actions: 'orphans' };
    default:
      return {};
  }
}

function makeVault(overrides: Partial<VaultToolApi> = {}): VaultToolApi & { calls: string[] } {
  const calls: string[] = [];
  const track = <T extends (...args: never[]) => unknown>(label: string, impl: T): T => (
    ((...args: never[]) => {
      calls.push(label);
      return impl(...args);
    }) as T
  );
  return {
    calls,
    readNote: track('readNote', async () => ({ path: 'n.md', content: 'body' })),
    editNote: track('editNote', async () => ({ path: 'n.md', replacements: 1 })),
    writeNote: track('writeNote', async () => ({ path: 'n.md' })),
    searchNotes: track('searchNotes', async () => [{ path: 'n.md', line: 1 }]),
    listPath: track('listPath', () => [{ path: 'n.md', kind: 'file' as const, name: 'n.md' }]),
    getNoteInfo: track('getNoteInfo', async () => ({ path: 'n.md' })),
    getRecentFiles: track('getRecentFiles', () => []),
    getLinks: track('getLinks', () => ({ path: 'n.md', links: [] })),
    getProperties: track('getProperties', () => ({ path: 'n.md', properties: { title: 't' }, value: 't' })),
    setProperty: track('setProperty', async () => ({ path: 'n.md', name: 'title' })),
    removeProperty: track('removeProperty', async () => ({ path: 'n.md', name: 'title' })),
    getTags: track('getTags', () => [{ name: 't', count: 1 }]),
    getTagInfo: track('getTagInfo', () => ({ name: 't', count: 1 })),
    getGraphAnalysis: track('getGraphAnalysis', () => ({ orphans: [], deadends: [], unresolved: [] })),
    movePath: track('movePath', async () => ({ path: 'a.md', newPath: 'b.md' })),
    trashPath: track('trashPath', async () => ({ path: 'a.md', kind: 'file' as const })),
    createFolder: track('createFolder', async () => ({ path: 'folder' })),
    getAttachmentInfo: track('getAttachmentInfo', async () => ({ path: 'a.png', size: 1, extension: 'png' })),
    ...overrides,
  };
}

describe('createMobileVaultTools', () => {
  it('registers exactly the 15 projected Mobile vault tool names', () => {
    const tools = createMobileVaultTools({
      vault: makeVault(),
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS },
      approval: { approve: async () => true },
    });
    expect(tools.map(tool => tool.name)).toEqual([...MOBILE_VAULT_TOOLS]);
    expect(tools).toHaveLength(15);
  });

  it('requests approval for all six mutations and denial blocks every vault call', async () => {
    const vault = makeVault();
    const requests: string[] = [];
    const tools = createMobileVaultTools({
      vault,
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS },
      approval: {
        approve: async (request) => {
          requests.push(request.toolName);
          return false;
        },
      },
    });
    for (const name of MUTATIONS) {
      const tool = tools.find(entry => entry.name === name)!;
      await expect(tool.execute('id', mutationParams(name))).rejects.toThrow(/denied/i);
    }
    expect(requests.sort()).toEqual([...MUTATIONS].sort());
    expect(vault.calls).toEqual([]);
  });

  it('never requests approval for read tools', async () => {
    const vault = makeVault();
    const requests: string[] = [];
    const tools = createMobileVaultTools({
      vault,
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS },
      approval: {
        approve: async (request) => {
          requests.push(request.toolName);
          return true;
        },
      },
    });
    for (const name of READS) {
      const tool = tools.find(entry => entry.name === name)!;
      await tool.execute('id', readParams(name));
    }
    expect(requests).toEqual([]);
    expect(vault.calls.length).toBeGreaterThan(0);
  });

  it('approves only set/remove property actions and denial prevents property vault calls', async () => {
    const vault = makeVault();
    const requests: string[] = [];
    const tools = createMobileVaultTools({
      vault,
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS },
      approval: {
        approve: async request => {
          requests.push(String(request.params.action));
          return false;
        },
      },
    });
    const properties = tools.find(tool => tool.name === 'obsidian_properties')!;
    await properties.execute('id', { action: 'list', path: 'n.md' });
    await properties.execute('id', { action: 'read', path: 'n.md', name: 'title' });
    await expect(properties.execute('id', {
      action: 'set', path: 'n.md', name: 'title', value: 'x',
    })).rejects.toThrow(/denied/i);
    await expect(properties.execute('id', {
      action: 'remove', path: 'n.md', name: 'title',
    })).rejects.toThrow(/denied/i);
    expect(requests).toEqual(['set', 'remove']);
    expect(vault.calls).toEqual(['getProperties', 'getProperties']);
  });

  it('aborts pending approval and never executes a late allow', async () => {
    const vault = makeVault();
    let allow!: (value: boolean) => void;
    const tools = createMobileVaultTools({
      vault,
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS },
      approval: { approve: () => new Promise(resolve => { allow = resolve; }) },
    });
    const controller = new AbortController();
    const execution = tools.find(tool => tool.name === 'obsidian_write')!
      .execute('id', mutationParams('obsidian_write'), controller.signal);
    controller.abort();
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    allow(true);
    await Promise.resolve();
    expect(vault.calls).toEqual([]);
  });

  it('never invokes CLI fallback when vault API throws', async () => {
    const vault = makeVault({
      searchNotes: async () => { throw new Error('api search failed'); },
      getLinks: () => { throw new Error('api links failed'); },
      getNoteInfo: async () => { throw new Error('api note info failed'); },
    });
    const tools = createMobileVaultTools({
      vault,
      settings: { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS, cliEnabled: true },
      approval: { approve: async () => true },
    });
    // API errors must surface unchanged (no CLI retry even when settings.cliEnabled).
    await expect(tools.find(t => t.name === 'obsidian_search')!.execute('id', { query: 'x' }))
      .rejects.toThrow(/^api search failed$/);
    await expect(tools.find(t => t.name === 'obsidian_links')!.execute('id', { path: 'n.md' }))
      .rejects.toThrow(/^api links failed$/);
    await expect(tools.find(t => t.name === 'obsidian_note_info')!.execute('id', { path: 'n.md' }))
      .rejects.toThrow(/^api note info failed$/);
  });
});
