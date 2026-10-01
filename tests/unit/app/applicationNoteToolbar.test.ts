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

import { ApplicationNoteToolbar } from "@/app/applicationNoteToolbar";
import { createMockApp } from "@test/helpers/mockApp";
import { createMockPiviSettings } from "@test/helpers/mockPiviSettings";

function createToolbar() {
  const settings = createMockPiviSettings();
  const toolbar = new ApplicationNoteToolbar({
    app: createMockApp() as never,
    pluginId: "pivi",
    processRunner: {} as ProcessRunner,
    getSettings: () => settings,
  });
  return { toolbar };
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

});
