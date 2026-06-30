const mockSharedStorageInitialize = jest.fn();
const mockGetTabManagerState = jest.fn();
const mockSavePiviSettings = jest.fn();
const mockGetAdapter = jest.fn();
const mockSetTabManagerState = jest.fn();
const mockListSessions = jest.fn();

jest.mock("../../../src/app/storage/SharedStorageService", () => ({
  SharedStorageService: jest.fn().mockImplementation(() => ({
    initialize: mockSharedStorageInitialize,
    getTabManagerState: mockGetTabManagerState,
    savePiviSettings: mockSavePiviSettings,
    setTabManagerState: mockSetTabManagerState,
    getAdapter: mockGetAdapter,
  })),
}));

jest.mock("../../../src/pi/session/PiSessionStore", () => ({
  PiSessionStore: jest.fn().mockImplementation(() => ({
    listSessions: mockListSessions,
    open: jest.fn(),
    writeSessionMeta: jest.fn(),
    writeUiContext: jest.fn(),
    create: jest.fn(),
  })),
}));

jest.mock("../../../src/pi/auth/ProviderSecretStorage", () => {
  const actual = jest.requireActual<
    typeof import("../../../src/pi/auth/ProviderSecretStorage")
  >("../../../src/pi/auth/ProviderSecretStorage");
  return {
    ...actual,
    isSecretStorageAvailable: jest.fn().mockReturnValue(false),
  };
});

import { AgentWorkspace } from "../../../src/core/agent/AgentWorkspace";
import { DEFAULT_PIVI_SETTINGS } from "../../../src/app/settings/defaultSettings";
import type { OpenSessionState } from "../../../src/core/types";
import { VIEW_TYPE_PIVI } from "../../../src/core/types";
import PiviPlugin from "../../../src/main";
import { ensurePiAgentBootstrapped } from "../../setupPiAgent";
import { createMockApp } from "../../helpers/mockApp";

function createPlugin(): PiviPlugin {
  const app = createMockApp();
  return new PiviPlugin(app, {
    id: "pivi",
    name: "Pivi",
    version: "0.0.0",
  } as never);
}

function openSession(
  overrides: Partial<OpenSessionState> = {},
): OpenSessionState {
  return {
    id: "conv-1",
    title: "Test",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    sessionId: null,
    sessionFile: ".pivi/sessions/a.jsonl",
    ...overrides,
  };
}

describe("PiviPlugin lifecycle", () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AgentWorkspace, "initializeAll").mockResolvedValue(undefined);
    mockSharedStorageInitialize.mockResolvedValue({ pivi: {} });
    mockGetTabManagerState.mockResolvedValue(null);
    mockListSessions.mockResolvedValue([]);
    mockGetAdapter.mockReturnValue({});
  });

  describe("loadSettings", () => {
    it("merges stored settings with defaults", async () => {
      mockSharedStorageInitialize.mockResolvedValue({
        pivi: { userName: "Ada", maxTabs: 5 },
      });

      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.settings.userName).toBe("Ada");
      expect(plugin.settings.maxTabs).toBe(5);
      expect(plugin.settings.model).toBe(DEFAULT_PIVI_SETTINGS.model);
    });

    it("normalizes plan permission mode back to normal on load", async () => {
      mockSharedStorageInitialize.mockResolvedValue({
        pivi: { permissionMode: "plan" },
      });

      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.settings.permissionMode).toBe("normal");
    });

    it("propagates storage initialization failures", async () => {
      mockSharedStorageInitialize.mockRejectedValue(
        new Error("corrupt settings file"),
      );

      const plugin = createPlugin();
      await expect(plugin.loadSettings()).rejects.toThrow(
        "corrupt settings file",
      );
    });

    it("hydrates openSession list from session store summaries", async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionId: "sess-a",
          sessionFile: ".pivi/sessions/a.jsonl",
          title: "First",
          updatedAt: 100,
        },
      ]);

      const plugin = createPlugin();
      await plugin.loadSettings();

      const list = plugin.getSessionList();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("sess-a");
      expect(list[0].title).toBe("First");
    });
  });

  describe("onunload", () => {
    it("persists tab manager state from open Pivi views", async () => {
      const tabState = { openTabs: [{ id: "tab-1", openSessionId: null }] };
      const mockTabManager = {
        getPersistedState: jest.fn().mockReturnValue(tabState),
      };
      const mockView = {
        getTabManager: () => mockTabManager,
      };

      const plugin = createPlugin();
      await plugin.loadSettings();
      plugin.app.workspace.getLeavesOfType = jest
        .fn()
        .mockReturnValue([{ view: mockView }]);

      plugin.onunload();
      await Promise.resolve();

      expect(mockSetTabManagerState).toHaveBeenCalledWith(tabState);
    });
  });

  describe("openSession helpers", () => {
    it("getSessionList maps previews from first user message", async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { sessions: OpenSessionState[] }).sessions = [
        openSession({
          messages: [
            { id: "m1", role: "user", content: "Hello world", timestamp: 1 },
          ],
        }),
      ];

      const list = plugin.getSessionList();
      expect(list[0].preview).toBe("Hello world");
      expect(list[0].messageCount).toBe(1);
    });

    it("findEmptySession returns openSession with no messages", async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { sessions: OpenSessionState[] }).sessions = [
        openSession({ id: "empty", messages: [] }),
        openSession({
          id: "nonempty",
          messages: [{ id: "m", role: "user", content: "x", timestamp: 1 }],
        }),
      ];

      expect(plugin.findEmptySession()?.id).toBe("empty");
    });

    it("getOpenSessionSync returns in-memory openSession by id", async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();
      (plugin as unknown as { sessions: OpenSessionState[] }).sessions = [
        openSession({ id: "find-me" }),
      ];

      expect(plugin.getOpenSessionSync("find-me")?.id).toBe("find-me");
      expect(plugin.getOpenSessionSync("missing")).toBeNull();
    });
  });

  describe("normalizeModelVariantSettings", () => {
    it("returns false when agent settings need no normalization", async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.normalizeModelVariantSettings()).toBe(false);
    });
  });

  describe("getView", () => {
    it("returns first Pivi view leaf when present", () => {
      const piviView = { getTabManager: jest.fn() };
      const otherView = {};
      const plugin = createPlugin();
      plugin.app.workspace.getLeavesOfType = jest
        .fn()
        .mockImplementation((type: string) => {
          if (type === VIEW_TYPE_PIVI) {
            return [{ view: otherView }, { view: piviView }];
          }
          return [];
        });

      expect(plugin.getView()).toBe(piviView);
    });
  });
});
