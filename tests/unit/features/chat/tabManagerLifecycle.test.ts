import type { ChatMessage } from '@pivi/core';
import { TabManager } from '@/ui/chat/tabs/TabManager';
import type { ForkContext } from '@/ui/chat/tabs/tabFork';
import type { TabData } from '@/ui/chat/tabs/types';
import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';

const tabMocks = jest.requireMock('@/ui/chat/tabs/Tab') as {
  activateTab: jest.Mock;
  createTab: jest.Mock;
  deactivateTab: jest.Mock;
  destroyTab: jest.Mock;
  getTabTitle: jest.Mock;
  initializeTabControllers: jest.Mock;
  initializeTabUI: jest.Mock;
  wireTabInputEvents: jest.Mock;
};

jest.mock('@/ui/chat/tabs/Tab', () => ({
  activateTab: jest.fn((tab) => { tab.lifecycleState = tab.openSessionId ? 'bound_active' : 'blank'; }),
  createTab: jest.fn(),
  deactivateTab: jest.fn((tab) => { tab.lifecycleState = tab.openSessionId ? 'bound_cold' : 'blank'; }),
  destroyTab: jest.fn(async (tab) => { tab.lifecycleState = 'closing'; }),
  getTabTitle: jest.fn((tab) => tab.openSessionId ?? tab.id),
  initializeTabControllers: jest.fn(),
  initializeTabUI: jest.fn(),
  wireTabInputEvents: jest.fn(),
}));

function makeTab(id: string, openSessionId: string | null = null): TabData {
  return {
    id,
    lifecycleState: openSessionId ? 'bound_cold' : 'blank',
    draftModel: null,
    openSessionId,
    sessionFile: openSessionId ? `${openSessionId}.jsonl` : null,
    leafId: null,
    service: null,
    serviceInitialized: false,
    state: { messages: [], isStreaming: false, hasPendingSessionSave: false, needsAttention: false } as never,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      openSessionController: {
        switchTo: jest.fn(async () => {}),
        save: jest.fn(async () => {}),
        initializeWelcome: jest.fn(),
      },
      streamController: null,
      inputController: null,
      navigationController: null,
    } as never,
    services: { subagentManager: { cleanup: jest.fn() }, titleGenerationService: null } as never,
    ui: { slashCommandDropdown: null } as never,
    dom: { eventCleanups: [] } as never,
    renderer: null,
  };
}

function makeManager() {
  const plugin = Object.assign(createMockPiviPluginStub({ settings: { maxTabs: 3 } }), {
    getOpenSessionById: jest.fn(async (id: string, leafId?: string | null) => ({
      id,
      title: id,
      sessionFile: `${id}.jsonl`,
      leafId: leafId ?? null,
      messages: [],
    })),
    openSessionByFile: jest.fn(async (file: string, leafId?: string | null) => ({
      id: `open-${file}`,
      sessionFile: file,
      leafId: leafId ?? null,
      title: file,
      messages: [],
    })),
    getOpenSessionSync: jest.fn((id: string) => ({ id, sessionFile: `${id}.jsonl`, messages: [] })),
    findSessionAcrossViews: jest.fn(() => null),
    getSessionList: jest.fn(() => []),
    forkSessionAt: jest.fn(async () => ({ sessionFile: 'fork.jsonl', sessionId: 'fork-session', leafId: 'fork-leaf' })),
    getPiWorkspace: jest.fn(() => null),
    createOpenSession: jest.fn(async () => ({ id: 'fork-open' })),
    updateSession: jest.fn(async () => {}),
    deleteSession: jest.fn(async () => {}),
  });
  let seq = 0;
  tabMocks.createTab.mockImplementation(({ openSession, tabId, draftModel }: { openSession?: { id: string; sessionFile?: string; leafId?: string | null }; tabId?: string; draftModel?: string }) => {
    const tab = makeTab(tabId ?? `tab-${++seq}`, openSession?.id ?? null);
    tab.sessionFile = openSession?.sessionFile ?? tab.sessionFile;
    tab.leafId = openSession?.leafId ?? null;
    tab.draftModel = draftModel ?? null;
    return tab;
  });
  const view = { leaf: {}, getTabManager: jest.fn(() => null) } as never;
  return { manager: new TabManager(asPiviPlugin(plugin), {} as HTMLElement, view), plugin };
}

describe('TabManager lifecycle guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates, switches, and closes tabs with lifecycle callbacks', async () => {
    const { manager } = makeManager();
    const first = await manager.createTab(null, 'first');
    const second = await manager.createTab('session-2', 'second');

    expect(manager.getActiveTabId()).toBe('second');
    expect(tabMocks.deactivateTab).toHaveBeenCalledWith(first);
    expect(tabMocks.activateTab).toHaveBeenCalledWith(second);

    await manager.switchToTab('first');
    expect(manager.getActiveTabId()).toBe('first');
    expect(tabMocks.deactivateTab).toHaveBeenCalledWith(second);

    await manager.closeTab('first', true);
    expect(tabMocks.destroyTab).toHaveBeenCalledWith(first);
    expect(manager.getActiveTabId()).toBe('second');
    expect(manager.getTab('first')).toBeNull();
  });

  it('persists and restores tab order, active tab, session file, and draft model', async () => {
    const { manager, plugin } = makeManager();
    await manager.createTab(null, 'draft', { draftModel: 'model-a' });
    await manager.createTab('session-b', 'bound');
    await manager.switchToTab('draft');

    expect(manager.getPersistedState()).toEqual({
      activeTabId: 'draft',
      openTabs: [
        { tabId: 'draft', draftModel: 'model-a' },
        { tabId: 'bound', sessionFile: 'session-b.jsonl' },
      ],
    });

    const restored = new TabManager(asPiviPlugin(plugin), {} as HTMLElement, { leaf: {}, getTabManager: jest.fn(() => null) } as never);
    await restored.restoreState({
      activeTabId: 'restored-2',
      openTabs: [
        { tabId: 'restored-1', sessionFile: 'a.jsonl', leafId: 'leaf-a' },
        { tabId: 'restored-2', draftModel: 'model-b', leafId: null },
      ],
    });

    expect(plugin.openSessionByFile).toHaveBeenCalledWith('a.jsonl');
    expect(restored.getActiveTabId()).toBe('restored-2');
    expect(restored.getAllTabs().map(tab => tab.id)).toEqual(['restored-1', 'restored-2']);
  });

  it('reloads an empty bound tab without treating null leaf as root', async () => {
    const { manager } = makeManager();
    const tab = await manager.createTab('session-a', 'tab-a');
    const switchTo = tab?.controllers.openSessionController?.switchTo as jest.Mock;
    switchTo.mockClear();

    await manager.openSession('session-a');

    expect(switchTo).toHaveBeenCalledWith('session-a');
  });

  it('forks directly into a new tab and restores fork messages when hydrate is empty', async () => {
    const { manager, plugin } = makeManager();
    await manager.createTab('source', 'source-tab');
    const forkMessages = [{ id: 'u1', role: 'user', content: 'one', timestamp: 1 }] as ChatMessage[];
    const context: ForkContext = {
      messages: forkMessages,
      sourceSessionId: 'source-session',
      forkAtEntryId: 'user-1',
      resumeAt: 'assistant-1',
      sourceTitle: 'Source title',
      forkAtUserMessage: 1,
    };

    const tab = await manager.forkToNewTab(context);

    expect(tab).not.toBeNull();
    expect(plugin.createOpenSession).toHaveBeenCalledWith({
      sessionFile: 'fork.jsonl',
      sessionId: 'fork-session',
    });
    expect(plugin.updateSession).toHaveBeenCalledWith('fork-open', expect.objectContaining({
      messages: forkMessages,
      title: 'Fork: Source title (#1)',
    }));
    expect(tab?.state.messages).toEqual(forkMessages);
  });
});
