import type { OpenSessionState } from "@pivi/pivi-agent-core/foundation";
import type { PiviSettings } from "@pivi/pivi-agent-core/foundation/settings";
import type { PiviUiFacades } from "@/app/hostContracts";
import type PiviPlugin from "@/main";
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
  getAllViews: jest.Mock;
  getAgentHostContext: jest.Mock;
  getVaultPath: jest.Mock;
  getUiFacades: jest.Mock;
  createChatService?: jest.Mock;
  createAuxQueryRunner?: jest.Mock;
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

  const stub: MockPiviPluginStub = {
    app,
    settings,
    storage,
    sessions: options.sessions ?? [],
    persistTabManagerState: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getAgentHostContext: jest.fn(),
    getVaultPath: jest.fn().mockReturnValue(options.vaultBasePath ?? "/mock-vault"),
    getUiFacades: jest.fn(() => createMockPiUiFacades()),
    createChatService: jest.fn(),
    createAuxQueryRunner: jest.fn(),
  };
  stub.getAgentHostContext.mockImplementation(() => ({
    settings: stub.settings as unknown as Record<string, unknown>,
    storage: stub.storage,
    vaultPath: "/mock-vault",
  }));
  return stub;
}

/** Cast stub to PiviPlugin for APIs that expect the full plugin type. */
export function asPiviPlugin(stub: MockPiviPluginStub): PiviPlugin {
  return stub as unknown as PiviPlugin;
}

/** Minimal Pi UI facades for features-layer unit tests. */
export function createMockPiUiFacades(
  overrides: Partial<PiviUiFacades> = {},
): PiviUiFacades {
  const { chatUIConfig: chatUIConfigOverride, ...rest } = overrides;
  return {
    chatUIConfig: {
      getModelOptions: () => [],
      isAdaptiveReasoningModel: () => false,
      getReasoningOptions: () => [],
      getDefaultReasoningValue: () => "low",
      getContextWindowSize: () => 200_000,
      isDefaultModel: () => false,
      applyModelDefaults: () => {},
      applyReasoningSelection: () => {},
      ...chatUIConfigOverride,
    },
    getSettingsSnapshot: (settings) => ({ ...settings }),
    commitSettingsSnapshot: () => {},
    listModelsForProvider: () => [],
    syncCustomProviders: () => {},
    fetchCustomProviderModels: async () => ({ count: 0 }),
    ...rest,
  };
}
