const mockSharedStorageInitialize = jest.fn();
const mockGetTabManagerState = jest.fn();
const mockSavePiviSettings = jest.fn();
const mockGetAdapter = jest.fn();
const mockSetTabManagerState = jest.fn();
const mockGetDeletedSessionFiles = jest.fn();
const mockSetDeletedSessionFiles = jest.fn();
const mockListSessions = jest.fn();
const mockSetupNoteToolbarIntegration = jest.fn();

jest.mock("@pivi/obsidian-host", () => {
  const actual = jest.requireActual<typeof import("@pivi/obsidian-host")>(
    "@pivi/obsidian-host",
  );
  return {
    ...actual,
  SharedStorageService: jest.fn().mockImplementation(() => ({
    initialize: mockSharedStorageInitialize,
    getTabManagerState: mockGetTabManagerState,
    getDeletedSessionFiles: mockGetDeletedSessionFiles,
    savePiviSettings: mockSavePiviSettings,
    setTabManagerState: mockSetTabManagerState,
    setDeletedSessionFiles: mockSetDeletedSessionFiles,
    getAdapter: mockGetAdapter,
  })),
  };
});

jest.mock("@pivi/pivi-agent-core/engine/pi/session/piSessionStore", () => ({
  PiSessionStore: jest.fn().mockImplementation(() => ({
    listSessions: mockListSessions,
    open: jest.fn(),
    writeSessionMeta: jest.fn(),
    writeUiContext: jest.fn(),
    create: jest.fn(),
  })),
}));

jest.mock("@pivi/pivi-agent-core/auth/providerSecretStorage", () => {
  const actual = jest.requireActual<
    typeof import("@pivi/pivi-agent-core/auth/providerSecretStorage")
  >("@pivi/pivi-agent-core/auth/providerSecretStorage");
  return {
    ...actual,
    isSecretStorageAvailable: jest.fn().mockReturnValue(false),
  };
});

jest.mock("@/app/noteToolbarIntegration", () => {
  const actual = jest.requireActual<
    typeof import("@/app/noteToolbarIntegration")
  >("@/app/noteToolbarIntegration");
  return {
    ...actual,
    setupNoteToolbarIntegration: mockSetupNoteToolbarIntegration,
  };
});

import type { OpenSessionState } from "@pivi/pivi-agent-core/foundation";
import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";
import PiviPlugin from "@/main";
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharedStorageInitialize.mockResolvedValue({ pivi: {} });
    mockGetTabManagerState.mockResolvedValue(null);
    mockGetDeletedSessionFiles.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([]);
    mockGetAdapter.mockReturnValue({});
    mockSetupNoteToolbarIntegration.mockReset();
  });

  describe("Note Toolbar integration", () => {
    it("coalesces matching styles but queues a different requested style", async () => {
      let resolveFirst!: (result: { status: "installed" }) => void;
      mockSetupNoteToolbarIntegration
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce({ status: "installed" });
      const plugin = createPlugin();
      await plugin.loadSettings();

      const first = plugin.setupNoteToolbarIntegration("label-and-icon");
      const duplicate = plugin.setupNoteToolbarIntegration("label-and-icon");
      const different = plugin.setupNoteToolbarIntegration("icon-only");

      expect(mockSetupNoteToolbarIntegration).toHaveBeenCalledTimes(1);
      resolveFirst({ status: "installed" });
      await expect(Promise.all([first, duplicate, different])).resolves.toEqual([
        { status: "installed" },
        { status: "installed" },
        { status: "installed" },
      ]);
      expect(mockSetupNoteToolbarIntegration).toHaveBeenCalledTimes(2);
      expect(mockSetupNoteToolbarIntegration.mock.calls[0]?.[0].itemStyle).toBe(
        "label-and-icon",
      );
      expect(mockSetupNoteToolbarIntegration.mock.calls[1]?.[0].itemStyle).toBe(
        "icon-only",
      );
    });
  });

  describe("loadSettings", () => {
    it("merges stored settings with defaults", async () => {
      mockSharedStorageInitialize.mockResolvedValue({
        pivi: { userName: "Ada" },
      });

      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(plugin.settings.userName).toBe("Ada");
      expect(plugin.settings.model).toBe(DEFAULT_PIVI_SETTINGS.model);
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

  describe("title generation model selection", () => {
    it("keeps valid loaded model selection unchanged", async () => {
      const plugin = createPlugin();
      await plugin.loadSettings();

      expect(mockSavePiviSettings).not.toHaveBeenCalled();
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
