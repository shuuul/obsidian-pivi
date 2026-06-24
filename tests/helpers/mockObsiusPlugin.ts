import type { OpenSessionState } from '../../src/core/types';
import type { ObsiusSettings } from '../../src/core/types/settings';
import type ObsiusPlugin from '../../src/main';
import { createMockApp, type MockAppOptions } from './mockApp';
import { createMockObsiusSettings } from './mockObsiusSettings';

export interface MockObsiusPluginStub {
  app: ReturnType<typeof createMockApp>;
  settings: ObsiusSettings;
  storage: {
    saveObsiusSettings: jest.Mock;
    getTabManagerState: jest.Mock;
    setTabManagerState: jest.Mock;
    getAdapter: jest.Mock;
    initialize: jest.Mock;
  };
  sessions: OpenSessionState[];
  persistTabManagerState: jest.Mock;
  getView: jest.Mock;
  getAllViews: jest.Mock;
}

export interface CreateMockObsiusPluginStubOptions extends MockAppOptions {
  settings?: Partial<ObsiusSettings>;
  sessions?: OpenSessionState[];
}

/**
 * Partial ObsiusPlugin-shaped stub for features-layer tests that need plugin.settings / app.
 * Does not instantiate ObsiusPlugin (avoids main.ts bootstrap side effects).
 */
export function createMockObsiusPluginStub(
  options: CreateMockObsiusPluginStubOptions = {},
): MockObsiusPluginStub {
  const app = createMockApp(options);
  const settings = createMockObsiusSettings(options.settings);
  const storage = {
    saveObsiusSettings: jest.fn().mockResolvedValue(undefined),
    getTabManagerState: jest.fn().mockResolvedValue(null),
    setTabManagerState: jest.fn().mockResolvedValue(undefined),
    getAdapter: jest.fn().mockReturnValue({}),
    initialize: jest.fn().mockResolvedValue({ obsius2: settings }),
  };

  return {
    app,
    settings,
    storage,
    sessions: options.sessions ?? [],
    persistTabManagerState: jest.fn().mockResolvedValue(undefined),
    getView: jest.fn().mockReturnValue(null),
    getAllViews: jest.fn().mockReturnValue([]),
  };
}

/** Cast stub to ObsiusPlugin for APIs that expect the full plugin type. */
export function asObsiusPlugin(stub: MockObsiusPluginStub): ObsiusPlugin {
  return stub as unknown as ObsiusPlugin;
}
