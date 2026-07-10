import { SharedStorageService } from '@pivi/obsidian-host/storage/sharedStorageService';

function createMemoryAdapter() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  return {
    files,
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
      mkdir: jest.fn(async (path: string) => { folders.add(path); }),
      read: jest.fn(async (path: string) => files.get(path) ?? ''),
      write: jest.fn(async (path: string, content: string) => { files.set(path, content); }),
    },
  };
}

function createPlugin() {
  const { adapter, files } = createMemoryAdapter();
  return {
    files,
    plugin: {
      app: { vault: { adapter } },
      loadData: jest.fn().mockResolvedValue({}),
      saveData: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('SharedStorageService tab manager state', () => {
  it('writes tab manager state to .pivi for vault sync', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const state = {
      activeTabId: 'tab-1',
      openTabs: [{ tabId: 'tab-1', sessionFile: '.pivi/sessions/a.jsonl' }],
    };

    await storage.setTabManagerState(state);

    expect(JSON.parse(files.get('.pivi/tab-manager-state.json') ?? '')).toEqual(state);
    expect(plugin.saveData).toHaveBeenCalledWith({ tabManagerState: state });
  });

  it('prefers .pivi tab manager state over legacy plugin data', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const vaultState = {
      activeTabId: 'vault-tab',
      openTabs: [{ tabId: 'vault-tab', sessionFile: '.pivi/sessions/vault.jsonl' }],
    };
    plugin.loadData.mockResolvedValue({
      tabManagerState: {
        activeTabId: 'legacy-tab',
        openTabs: [{ tabId: 'legacy-tab' }],
      },
    });
    files.set('.pivi/tab-manager-state.json', JSON.stringify(vaultState));

    await expect(storage.getTabManagerState()).resolves.toEqual(vaultState);
  });

  it('migrates legacy plugin tab manager state into .pivi when vault state is missing', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const legacyState = {
      activeTabId: 'legacy-tab',
      openTabs: [{ tabId: 'legacy-tab', isArchived: true }],
    };
    plugin.loadData.mockResolvedValue({ tabManagerState: legacyState });

    await expect(storage.getTabManagerState()).resolves.toEqual(legacyState);
    expect(JSON.parse(files.get('.pivi/tab-manager-state.json') ?? '')).toEqual(legacyState);
  });
});
