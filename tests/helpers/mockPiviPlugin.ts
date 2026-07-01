import type { OpenSessionState } from "../../src/pi/types";
import type { PiviSettings } from "../../src/pi/types/settings";
import type PiviPlugin from "../../src/main";
import { createMockApp, type MockAppOptions } from "./mockApp";
import { createMockPiviSettings } from "./mockPiviSettings";

export interface MockPiviPluginStub {
  app: ReturnType<typeof createMockApp>;
  settings: PiviSettings;
  storage: {
    savePiviSettings: jest.Mock;
    getTabManagerState: jest.Mock;
    setTabManagerState: jest.Mock;
    getAdapter: jest.Mock;
    initialize: jest.Mock;
  };
  sessions: OpenSessionState[];
  persistTabManagerState: jest.Mock;
  getView: jest.Mock;
  getAllViews: jest.Mock;
  getAgentHostContext: jest.Mock;
}

export interface CreateMockPiviPluginStubOptions extends MockAppOptions {
  settings?: Partial<PiviSettings>;
  sessions?: OpenSessionState[];
}

/**
 * Partial PiviPlugin-shaped stub for features-layer tests that need plugin.settings / app.
 * Does not instantiate PiviPlugin (avoids main.ts bootstrap side effects).
 */
export function createMockPiviPluginStub(
  options: CreateMockPiviPluginStubOptions = {},
): MockPiviPluginStub {
  const app = createMockApp(options);
  const settings = createMockPiviSettings(options.settings);
  const storage = {
    savePiviSettings: jest.fn().mockResolvedValue(undefined),
    getTabManagerState: jest.fn().mockResolvedValue(null),
    setTabManagerState: jest.fn().mockResolvedValue(undefined),
    getAdapter: jest.fn().mockReturnValue({}),
    initialize: jest.fn().mockResolvedValue({ pivi: settings }),
  };

  const stub = {
    app,
    settings,
    storage,
    sessions: options.sessions ?? [],
    persistTabManagerState: jest.fn().mockResolvedValue(undefined),
    getView: jest.fn().mockReturnValue(null),
    getAllViews: jest.fn().mockReturnValue([]),
    getAgentHostContext: jest.fn(),
  };
  stub.getAgentHostContext.mockImplementation(() => ({
    settings: stub.settings as unknown as Record<string, unknown>,
    storage: stub.storage,
    vaultPath: "/mock-vault",
    rawHost: stub,
  }));
  return stub;
}

/** Cast stub to PiviPlugin for APIs that expect the full plugin type. */
export function asPiviPlugin(stub: MockPiviPluginStub): PiviPlugin {
  return stub as unknown as PiviPlugin;
}
