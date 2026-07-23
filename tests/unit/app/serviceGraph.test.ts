const assertBundledReactRuntime = jest.fn();
const createPiWorkspaceServices = jest.fn();

jest.mock('@pivi/pivi-react', () => ({ assertBundledReactRuntime }));
jest.mock('@/app/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/app/workspace/PiWorkspaceServices', () => ({ createPiWorkspaceServices }));

import { getBoundSessionJournal } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import { SessionJournalVersionError } from '@pivi/pivi-agent-core/session/sessionJournal';
import {
  createPluginServiceGraph,
  createSessionStore,
  reconcileSessionCloudRecovery,
} from '@/app/serviceGraph';

describe('createPluginServiceGraph', () => {
  beforeEach(() => {
    assertBundledReactRuntime.mockReset();
    createPiWorkspaceServices.mockReset();
  });

  it('disables an unsupported journal without blocking startup recovery', () => {
    const journalStore = {
      load: jest.fn(() => { throw new SessionJournalVersionError(2); }),
      save: jest.fn(),
    };

    expect(() => reconcileSessionCloudRecovery({} as never, '/vault', journalStore))
      .not.toThrow();
    expect(getBoundSessionJournal()).toBeNull();
    expect(journalStore.save).not.toHaveBeenCalled();

    expect(() => createSessionStore(
      {} as never,
      '/vault',
      {} as never,
      journalStore,
    )).not.toThrow();
    expect(getBoundSessionJournal()).toBeNull();
  });

  it('passes only explicit workspace construction capabilities', async () => {
    const vaultAdapter = { read: jest.fn() };
    const workspace = { slashCommandCatalog: {} };
    const plugin = {
      app: { secretStorage: {}, vault: {} },
      settings: { model: 'test/model' },
      registerEvent: jest.fn(),
      storage: { getAdapter: jest.fn(() => vaultAdapter) },
    };
    createPiWorkspaceServices.mockResolvedValue(workspace);

    const result = await createPluginServiceGraph(plugin as never);

    expect(assertBundledReactRuntime).toHaveBeenCalledTimes(1);
    expect(createPiWorkspaceServices).toHaveBeenCalledWith({
      host: plugin,
      vaultAdapter,
    });
    expect(result).toEqual({ piWorkspace: workspace });
    expect(result).not.toHaveProperty('obsidianHost');
  });
});
