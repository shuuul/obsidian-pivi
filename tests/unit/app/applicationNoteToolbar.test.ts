const mockSetupNoteToolbarIntegration = jest.fn();

jest.mock("@/app/noteToolbarIntegration", () => {
  const actual = jest.requireActual<typeof import("@/app/noteToolbarIntegration")>(
    "@/app/noteToolbarIntegration",
  );
  return {
    ...actual,
    setupNoteToolbarIntegration: mockSetupNoteToolbarIntegration,
  };
});

import type { ProcessRunner } from "@pivi/agent/ports";
import type { SlashCatalogEntry } from "@pivi/agent/skills/commands/slashCommandEntry";
import { getIcon } from "obsidian";

import { ApplicationNoteToolbar } from "@/app/applicationNoteToolbar";
import { createMockApp } from "@test/helpers/mockApp";
import { createMockPiviSettings } from "@test/helpers/mockPiviSettings";

function createToolbar(reconcileWorkspaceCommands = jest.fn().mockResolvedValue(undefined)) {
  const settings = createMockPiviSettings();
  const toolbar = new ApplicationNoteToolbar({
    app: createMockApp() as never,
    pluginId: "pivi",
    processRunner: {} as ProcessRunner,
    getSettings: () => settings,
    reconcileWorkspaceCommands,
  });
  return { toolbar, reconcileWorkspaceCommands };
}

function entry(overrides: Partial<SlashCatalogEntry>): SlashCatalogEntry {
  return { name: "summarize", ...overrides } as SlashCatalogEntry;
}

describe("ApplicationNoteToolbar", () => {
  beforeEach(() => {
    mockSetupNoteToolbarIntegration.mockReset();
    mockSetupNoteToolbarIntegration.mockResolvedValue({ status: "configured" });
  });

  it("targets the selection command with the requested item style", async () => {
    const { toolbar } = createToolbar();

    await toolbar.setupSelectionCommand("icon-only");

    expect(mockSetupNoteToolbarIntegration).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "pivi:add-selection-to-chat-input",
      itemStyle: "icon-only",
    }));
    expect(mockSetupNoteToolbarIntegration.mock.calls[0]?.[0]).not.toHaveProperty("itemIcon");
  });

  it("registers workspace commands before adding an icon-only item for one", async () => {
    const order: string[] = [];
    const reconcile = jest.fn(async () => { order.push("reconcile"); });
    mockSetupNoteToolbarIntegration.mockImplementation(async () => {
      order.push("setup");
      return { status: "configured" };
    });
    const { toolbar } = createToolbar(reconcile);

    await toolbar.setupWorkspaceCommand(entry({ integrationKey: "key-1", icon: "sparkles" }));

    expect(order).toEqual(["reconcile", "setup"]);
    expect(mockSetupNoteToolbarIntegration).toHaveBeenCalledWith(expect.objectContaining({
      itemStyle: "icon-only",
      itemIcon: "sparkles",
    }));
  });

  it("falls back to the default icon when the configured icon is unknown", async () => {
    jest.mocked(getIcon).mockReturnValueOnce(null);
    const { toolbar } = createToolbar();

    await toolbar.setupWorkspaceCommand(entry({ integrationKey: "key-1", icon: "missing-icon" }));

    expect(mockSetupNoteToolbarIntegration).toHaveBeenCalledWith(expect.objectContaining({
      itemIcon: "message-square",
    }));
  });

  it("rejects a workspace command without an integration key before reconciling", async () => {
    const { toolbar, reconcileWorkspaceCommands } = createToolbar();

    await expect(toolbar.setupWorkspaceCommand(entry({})))
      .rejects.toThrow("Workspace command /summarize has no integration key");
    expect(reconcileWorkspaceCommands).not.toHaveBeenCalled();
    expect(mockSetupNoteToolbarIntegration).not.toHaveBeenCalled();
  });
});
