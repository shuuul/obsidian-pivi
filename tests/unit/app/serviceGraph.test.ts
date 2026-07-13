const assertBundledReactRuntime = jest.fn();
const createPiWorkspaceServices = jest.fn();

jest.mock('@pivi/pivi-react', () => ({ assertBundledReactRuntime }));
jest.mock('@/app/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/app/workspace/PiWorkspaceServices', () => ({ createPiWorkspaceServices }));

import { createPluginServiceGraph } from '@/app/serviceGraph';

describe('createPluginServiceGraph', () => {
  beforeEach(() => {
    assertBundledReactRuntime.mockReset();
    createPiWorkspaceServices.mockReset();
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
