const mockSharedStorageInitialize = jest.fn();
const mockGetTabManagerState = jest.fn();
const mockSaveObsiusSettings = jest.fn();
const mockGetAdapter = jest.fn();
const mockSetTabManagerState = jest.fn();
const mockListSessions = jest.fn();

jest.mock('../../../src/app/storage/SharedStorageService', () => ({
  SharedStorageService: jest.fn().mockImplementation(() => ({
    initialize: mockSharedStorageInitialize,
    getTabManagerState: mockGetTabManagerState,
    saveObsiusSettings: mockSaveObsiusSettings,
    setTabManagerState: mockSetTabManagerState,
    getAdapter: mockGetAdapter,
  })),
}));

jest.mock('../../../src/pi/session/sessionStoreRegistry', () => ({
  getSessionStore: () => ({
    listSessions: mockListSessions,
    open: jest.fn(),
    writeSessionMeta: jest.fn(),
    writeUiContext: jest.fn(),
  }),
  setSessionStore: jest.fn(),
}));

jest.mock('../../../src/pi/auth/ProviderSecretStorage', () => {
  const actual = jest.requireActual<typeof import('../../../src/pi/auth/ProviderSecretStorage')>(
    '../../../src/pi/auth/ProviderSecretStorage',
  );
  return {
    ...actual,
    isSecretStorageAvailable: jest.fn().mockReturnValue(false),
    syncPiProvidersFromKeychain: jest.fn().mockResolvedValue({ changed: false }),
  };
});

import { AgentWorkspace } from '../../../src/core/agent/AgentWorkspace';
import { DEFAULT_OBSIUS_SETTINGS } from '../../../src/app/settings/defaultSettings';
import type { Conversation } from '../../../src/core/types';
import { VIEW_TYPE_OBSIUS } from '../../../src/core/types';
import ObsiusPlugin from '../../../src/main';
import { ensurePiAgentBootstrapped } from '../../setupPiAgent';
import { createMockApp } from '../../helpers/mockApp';

function createPlugin(): ObsiusPlugin {
  const app = createMockApp();
  return new ObsiusPlugin(app, { id: 'obsius2', name: 'Obsius', version: '0.0.0' } as never);
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    sessionId: null,
    sessionFile: '.obsius/sessions/a.jsonl',
    ...overrides,
  };
}

describe('ObsiusPlugin lifecycle', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AgentWorkspace, 'initializeAll').mockResolvedValue(undefined);
    mockSharedStorageInitialize.mockResolvedValue({ obsius2: {} });
    mockGetTabManagerState.mockResolvedValue(null);
    mockListSessions.mockResolvedValue([]);
    mockGetAdapter.mockReturnValue({});
  });

  describe('loadSettings', () => {
    it('merges stored settings with defaults', async () => {
      mockSharedStorageInitialize.mockResolvedValue({
        obsius2: { userName: 'Ada', maxTabs: 5 },
      });

      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.settings.userName).toBe('Ada');
      expect(plugin.settings.maxTabs).toBe(5);
      expect(plugin.settings.model).toBe(DEFAULT_OBSIUS_SETTINGS.model);
    });

    it('normalizes plan permission mode back to normal on load', async () => {
      mockSharedStorageInitialize.mockResolvedValue({
        obsius2: { permissionMode: 'plan' },
      });

      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.settings.permissionMode).toBe('normal');
    });

    it('propagates storage initialization failures', async () => {
      mockSharedStorageInitialize.mockRejectedValue(new Error('corrupt settings file'));

      const plugin = createPlugin();
      await expect(plugin.loadSettings()).rejects.toThrow('corrupt settings file');
    });

    it('hydrates conversation list from session store summaries', async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionId: 'sess-a',
          sessionFile: '.obsius/sessions/a.jsonl',
          title: 'First',
          updatedAt: 100,
        },
      ]);

      const plugin = createPlugin();
      await plugin.loadSettings();

      const list = plugin.getConversationList();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('sess-a');
      expect(list[0].title).toBe('First');
    });
  });

  describe('onunload', () => {
    it('persists tab manager state from open Obsius views', async () => {
      const tabState = { openTabs: [{ id: 'tab-1', conversationId: null }] };
      const mockTabManager = {
        getPersistedState: jest.fn().mockReturnValue(tabState),
      };
      const mockView = {
        getTabManager: () => mockTabManager,
      };

      const plugin = createPlugin();
      await plugin.loadSettings();
      plugin.app.workspace.getLeavesOfType = jest.fn().mockReturnValue([
        { view: mockView },
      ]);

      plugin.onunload();
      await Promise.resolve();

      expect(mockSetTabManagerState).toHaveBeenCalledWith(tabState);
    });
  });

  describe('conversation helpers', () => {
    it('getConversationList maps previews from first user message', async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { conversations: Conversation[] }).conversations = [
        conversation({
          messages: [{ id: 'm1', role: 'user', content: 'Hello world', timestamp: 1 }],
        }),
      ];

      const list = plugin.getConversationList();
      expect(list[0].preview).toBe('Hello world');
      expect(list[0].messageCount).toBe(1);
    });

    it('findEmptyConversation returns conversation with no messages', async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { conversations: Conversation[] }).conversations = [
        conversation({ id: 'empty', messages: [] }),
        conversation({ id: 'nonempty', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }] }),
      ];

      expect(plugin.findEmptyConversation()?.id).toBe('empty');
    });

    it('getConversationSync returns in-memory conversation by id', async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { conversations: Conversation[] }).conversations = [
        conversation({ id: 'find-me' }),
      ];

      expect(plugin.getConversationSync('find-me')?.id).toBe('find-me');
      expect(plugin.getConversationSync('missing')).toBeNull();
    });
  });

  describe('normalizeModelVariantSettings', () => {
    it('returns false when agent settings need no normalization', async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.normalizeModelVariantSettings()).toBe(false);
    });
  });

  describe('getView', () => {
    it('returns first Obsius view leaf when present', () => {
      const obsiusView = { getTabManager: jest.fn() };
      const otherView = {};
      const plugin = createPlugin();
      plugin.app.workspace.getLeavesOfType = jest.fn().mockImplementation((type: string) => {
        if (type === VIEW_TYPE_OBSIUS) {
          return [{ view: otherView }, { view: obsiusView }];
        }
        return [];
      });

      expect(plugin.getView()).toBe(obsiusView);
    });
  });
});
